'use client';

import { useState, useRef, useEffect } from 'react';
import { downscaleImage } from '@/lib/image';
import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  MAX_TOTAL_BYTES,
  MAX_TOTAL_MB,
  isSupportedScheduleFile,
} from '@/lib/uploadLimits';

interface FileWithPreview {
  file: File;
  preview: string | null;
  id: string;
}

type SyncDestination = 'download' | 'google' | 'outlook';

interface AuthStatus {
  google: boolean;
  outlook: boolean;
}

export default function Home() {
  const [selectedFiles, setSelectedFiles] = useState<FileWithPreview[]>([]);
  const [format, setFormat] = useState<'outlook' | 'apple'>('apple');
  const [destination, setDestination] = useState<SyncDestination>('download');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    google: false,
    outlook: false,
  });
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'weeks' | 'date'>('weeks');
  const [repeatWeeks, setRepeatWeeks] = useState<number>(4);
  const [repeatUntilDate, setRepeatUntilDate] = useState<string>('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopProgressTimer = () => {
    if (progressTimerRef.current !== null) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  };

  /**
   * Reading a multi-page schedule is a single long request — there is no partial
   * response to report against, so the bar is driven by elapsed time instead.
   * It eases toward 85% and never reaches it, so it can't imply completion that
   * hasn't happened; the real jump to 90%+ comes from the response landing.
   * Without this the bar sat at 20% for minutes and looked like a hang.
   */
  const startProgressTimer = () => {
    stopProgressTimer();
    const startedAt = Date.now();
    setElapsedSeconds(0);
    progressTimerRef.current = setInterval(() => {
      const seconds = (Date.now() - startedAt) / 1000;
      setElapsedSeconds(Math.floor(seconds));
      setProcessingProgress(20 + 65 * (1 - Math.exp(-seconds / 70)));
    }, 1000);
  };

  useEffect(() => stopProgressTimer, []);

  useEffect(() => {
    // Detect if user is on mobile
    const checkMobile = () => {
      const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || 
                            (typeof window !== 'undefined' && window.innerWidth < 768);
      setIsMobile(isMobileDevice);
      // On mobile, force Apple Calendar format
      if (isMobileDevice) {
        setFormat('apple');
      }
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const requiresConnectedAccount = destination !== 'download';
  const isSelectedProviderConnected =
    destination === 'google'
      ? authStatus.google
      : destination === 'outlook'
      ? authStatus.outlook
      : true;
  const canUseSelectedDestination =
    !requiresConnectedAccount || isSelectedProviderConnected;
  const isConvertDisabled =
    isProcessing || selectedFiles.length === 0 || !canUseSelectedDestination;

  useEffect(() => {
    const refreshAuthStatus = async () => {
      try {
        const response = await fetch('/api/auth/status');
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as AuthStatus;
        setAuthStatus({
          google: Boolean(data.google),
          outlook: Boolean(data.outlook),
        });
      } catch {
        // Keep UI functional even if status request fails
      }
    };

    refreshAuthStatus();

    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const authError = params.get('auth_error');
    if (connected === 'google' || connected === 'outlook') {
      setStatusMessage(
        `${connected === 'google' ? 'Google' : 'Outlook'} connected successfully.`
      );
      refreshAuthStatus();
      params.delete('connected');
      const nextUrl = `${window.location.pathname}${
        params.toString() ? `?${params.toString()}` : ''
      }`;
      window.history.replaceState({}, '', nextUrl);
    } else if (authError) {
      setError(`Calendar connection failed: ${decodeURIComponent(authError)}`);
      params.delete('auth_error');
      const nextUrl = `${window.location.pathname}${
        params.toString() ? `?${params.toString()}` : ''
      }`;
      window.history.replaceState({}, '', nextUrl);
    }
  }, []);

  const handleFilesSelect = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const supportedFiles = fileArray.filter(isSupportedScheduleFile);
    const withinFileLimit = supportedFiles.filter(file => file.size <= MAX_FILE_BYTES);

    // The combined size matters as much as any single file, since every selected
    // file goes up in one request. Count what is already staged, then take new
    // files only while the running total still fits.
    let runningTotal = selectedFiles.reduce((sum, f) => sum + f.file.size, 0);
    const scheduleFiles: File[] = [];
    for (const file of withinFileLimit) {
      if (runningTotal + file.size > MAX_TOTAL_BYTES) {
        break;
      }
      runningTotal += file.size;
      scheduleFiles.push(file);
    }

    const skippedTypes = fileArray.length - supportedFiles.length;
    const skippedTooBig = supportedFiles.length - withinFileLimit.length;
    const skippedOverTotal = withinFileLimit.length - scheduleFiles.length;

    if (scheduleFiles.length === 0) {
      setError(
        skippedOverTotal > 0
          ? `That would exceed the ${MAX_TOTAL_MB}MB total upload limit. Remove a file and try again.`
          : skippedTooBig > 0
            ? `Each file must be under ${MAX_FILE_MB}MB.`
            : 'Please select a PDF or a supported image (JPEG, PNG, GIF, or WebP)'
      );
      return;
    }

    setError(
      skippedOverTotal > 0
        ? `Some files were skipped to stay under the ${MAX_TOTAL_MB}MB total limit.`
        : skippedTooBig > 0
          ? `Some files were skipped for being over ${MAX_FILE_MB}MB.`
          : skippedTypes > 0
            ? 'Some files were skipped. Use PDF, JPEG, PNG, GIF, or WebP files.'
            : null
    );

    scheduleFiles.forEach(file => {
      const addFile = (preview: string | null) => {
        const newFile: FileWithPreview = {
          file,
          preview,
          id: `${file.name}-${Date.now()}-${Math.random()}`
        };
        setSelectedFiles(prev => [...prev, newFile]);
      };

      if (file.type === 'application/pdf') {
        addFile(null);
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        addFile(reader.result as string);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!canUseSelectedDestination) {
      setError(
        `Connect your ${
          destination === 'google' ? 'Google' : 'Outlook'
        } account before uploading files for sync.`
      );
      return;
    }
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFilesSelect(files);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canUseSelectedDestination) {
      setError(
        `Connect your ${
          destination === 'google' ? 'Google' : 'Outlook'
        } account before uploading files for sync.`
      );
      e.target.value = '';
      return;
    }
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFilesSelect(files);
    }
  };

  const handleUploadClick = () => {
    if (!canUseSelectedDestination) {
      setError(
        `Connect your ${
          destination === 'google' ? 'Google' : 'Outlook'
        } account before uploading files for sync.`
      );
      return;
    }
    fileInputRef.current?.click();
  };

  const handleConnectProvider = (provider: 'google' | 'outlook') => {
    window.location.href = `/api/auth/${provider}/start`;
  };

  const handleDisconnectProvider = async (provider: 'google' | 'outlook') => {
    try {
      const response = await fetch('/api/auth/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      if (!response.ok) {
        throw new Error('Disconnect failed');
      }
      setAuthStatus((prev) => ({ ...prev, [provider]: false }));
      if (destination === provider) {
        setDestination('download');
      }
      setStatusMessage(
        `${provider === 'google' ? 'Google' : 'Outlook'} disconnected.`
      );
      setError(null);
    } catch {
      setError('Failed to disconnect provider. Please try again.');
    }
  };

  const handleConvert = async () => {
    if (selectedFiles.length === 0) {
      setError('Please select at least one PDF or image first');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setStatusMessage(null);
    setProcessingProgress(0);

    try {
      // Shrink oversized images before they go up, not at selection time: the
      // size limits and the "remove this one" list should describe the file the
      // user actually picked.
      const uploads = await Promise.all(
        selectedFiles.map((fileWithPreview) => downscaleImage(fileWithPreview.file))
      );

      const formData = new FormData();
      uploads.forEach((file) => {
        formData.append('files', file);
      });

      if (destination === 'download') {
        formData.append('format', format);
      } else {
        const isConnected = destination === 'google' ? authStatus.google : authStatus.outlook;
        if (!isConnected) {
          throw new Error(
            `Please connect your ${
              destination === 'google' ? 'Google' : 'Outlook'
            } account first.`
          );
        }
        formData.append('provider', destination);
        formData.append(
          'timeZone',
          Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
        );
      }

      if (repeatWeekly) {
        formData.append('repeatWeekly', 'true');
        formData.append('repeatMode', repeatMode);
        if (repeatMode === 'weeks') {
          formData.append('repeatWeeks', repeatWeeks.toString());
        } else if (repeatMode === 'date' && repeatUntilDate) {
          formData.append('repeatUntilDate', repeatUntilDate);
        }
      }

      startProgressTimer();
      const endpoint = destination === 'download' ? '/api/convert' : '/api/sync';
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
      });

      stopProgressTimer();
      setProcessingProgress(90);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to convert schedule');
      }

      setProcessingProgress(95);
      if (destination === 'download') {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'schedule.ics';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        setStatusMessage('Calendar file downloaded.');
      } else {
        const result = await response.json();
        setStatusMessage(
          `Synced ${result.syncedCount} event${
            result.syncedCount === 1 ? '' : 's'
          } to ${destination === 'google' ? 'Google Calendar' : 'Outlook Calendar'}.`
        );
      }
      
      setProcessingProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      stopProgressTimer();
      setIsProcessing(false);
      setProcessingProgress(0);
      setElapsedSeconds(0);
    }
  };

  const handleRemoveFile = (id: string) => {
    setSelectedFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleClearAll = () => {
    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <main className="container mx-auto px-4 sm:px-6 py-8 sm:py-16 max-w-4xl">
        <div className="text-center mb-8 sm:mb-12">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-3 sm:mb-4">
            Schedule to Calendar
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-gray-600 dark:text-gray-300 px-2">
            Upload a work schedule or class timetable, as a PDF or image, and download or sync it to your calendar
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-4 sm:p-6 md:p-8 mb-6 sm:mb-8">
          {/* Delivery Selection */}
          <div className="space-y-3 sm:space-y-4 mb-5 sm:mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Delivery Method:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setDestination('download')}
                className={`p-3 rounded-lg border-2 transition-colors text-left ${
                  destination === 'download'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-blue-400'
                }`}
              >
                <p className="font-medium text-gray-900 dark:text-white">Download .ics</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Apple/manual import</p>
              </button>
              <button
                type="button"
                onClick={() => setDestination('google')}
                className={`p-3 rounded-lg border-2 transition-colors text-left ${
                  destination === 'google'
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-green-400'
                }`}
              >
                <p className="font-medium text-gray-900 dark:text-white">Google Calendar</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Native sync</p>
              </button>
              <button
                type="button"
                onClick={() => setDestination('outlook')}
                className={`p-3 rounded-lg border-2 transition-colors text-left ${
                  destination === 'outlook'
                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-purple-400'
                }`}
              >
                <p className="font-medium text-gray-900 dark:text-white">Outlook Calendar</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Native sync</p>
              </button>
            </div>

            {destination === 'download' && (
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                Apple/manual flow. No account connection required before upload.
              </p>
            )}

            {destination !== 'download' && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {destination === 'google' ? 'Google' : 'Outlook'} account
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {destination === 'google'
                        ? authStatus.google
                          ? 'Connected'
                          : 'Not connected'
                        : authStatus.outlook
                        ? 'Connected'
                        : 'Not connected'}
                    </p>
                  </div>
                  {destination === 'google' ? (
                    authStatus.google ? (
                      <button
                        type="button"
                        onClick={() => handleDisconnectProvider('google')}
                        className="px-3 py-2 text-sm rounded-lg border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/20"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleConnectProvider('google')}
                        className="px-3 py-2 text-sm rounded-lg bg-green-600 hover:bg-green-700 text-white"
                      >
                        Connect Google
                      </button>
                    )
                  ) : authStatus.outlook ? (
                    <button
                      type="button"
                      onClick={() => handleDisconnectProvider('outlook')}
                      className="px-3 py-2 text-sm rounded-lg border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/20"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleConnectProvider('outlook')}
                      className="px-3 py-2 text-sm rounded-lg bg-purple-600 hover:bg-purple-700 text-white"
                    >
                      Connect Outlook
                    </button>
                  )}
                </div>
                {!canUseSelectedDestination && (
                  <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                    Connect your {destination === 'google' ? 'Google' : 'Outlook'} account
                    before uploading files.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* File Upload Area */}
          {selectedFiles.length === 0 ? (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className={`border-2 border-dashed rounded-xl p-8 sm:p-12 text-center transition-colors touch-manipulation ${
                canUseSelectedDestination
                  ? 'border-gray-300 dark:border-gray-600 cursor-pointer hover:border-blue-500 dark:hover:border-blue-400 active:border-blue-600'
                  : 'border-amber-300 dark:border-amber-700 cursor-not-allowed bg-amber-50/40 dark:bg-amber-900/10'
              }`}
              onClick={handleUploadClick}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                multiple
                onChange={handleFileInputChange}
                disabled={!canUseSelectedDestination}
                className="hidden"
              />
              <svg
                className="mx-auto h-12 w-12 sm:h-16 sm:w-16 text-gray-400 dark:text-gray-500 mb-3 sm:mb-4"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 48 48"
              >
                <path
                  d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <p className="text-base sm:text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">
                {canUseSelectedDestination
                  ? 'Drag and drop your schedule PDFs or images here'
                  : `Connect ${
                      destination === 'google' ? 'Google' : 'Outlook'
                    } before uploading`}
              </p>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                {canUseSelectedDestination
                  ? `or tap to browse — PDF, JPEG, PNG, GIF, or WebP, up to ${MAX_FILE_MB}MB each. You can select multiple files.`
                  : 'Once connected, upload and sync will be enabled.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4 sm:space-y-6">
              {/* Preview Grid */}
              <div className="space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
                    Selected Files ({selectedFiles.length})
                  </h3>
                  <button
                    onClick={handleClearAll}
                    className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium py-2 px-2 -mr-2 touch-manipulation"
                  >
                    Clear All
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  {selectedFiles.map((fileWithPreview) => (
                    <div key={fileWithPreview.id} className="relative group">
                      {fileWithPreview.preview ? (
                        <img
                          src={fileWithPreview.preview}
                          alt={`Preview: ${fileWithPreview.file.name}`}
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 max-h-48 sm:max-h-64 object-contain bg-gray-50 dark:bg-gray-900"
                        />
                      ) : (
                        <div className="flex h-48 sm:h-64 flex-col items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-red-600 dark:border-gray-700 dark:bg-gray-900 dark:text-red-400">
                          <svg className="mb-3 h-14 w-14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 3h7l5 5v13H7V3zm7 0v5h5M9.5 14h5M9.5 17h5" />
                          </svg>
                          <span className="text-sm font-semibold">PDF document</span>
                        </div>
                      )}
                      <button
                        onClick={() => handleRemoveFile(fileWithPreview.id)}
                        className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white rounded-full p-2 sm:p-2.5 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100 touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
                        aria-label="Remove file"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                        {fileWithPreview.file.name}
                      </p>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleUploadClick}
                  className="w-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 text-center hover:border-blue-500 dark:hover:border-blue-400 active:border-blue-600 transition-colors text-gray-600 dark:text-gray-400 touch-manipulation min-h-[44px]"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_FILE_TYPES}
                    multiple
                    onChange={handleFileInputChange}
                    disabled={!canUseSelectedDestination}
                    className="hidden"
                  />
                  + Add More Files
                </button>
              </div>

              {/* Repeat Options */}
              <div className="space-y-3 sm:space-y-4">
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 sm:p-4">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    Repeat schedule
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    For a schedule that shows a single week, turn this on to repeat every
                    extracted event weekly, then choose when repeats should end.
                  </p>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    If your file already spells out its own date range — like a term
                    timetable that runs for several weeks — every week is created
                    automatically and this setting is ignored for those events.
                  </p>
                </div>
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={repeatWeekly}
                    onChange={(e) => setRepeatWeekly(e.target.checked)}
                    className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Repeat this schedule weekly
                  </span>
                </label>
                
                {repeatWeekly && (
                  <div className="ml-8 space-y-4">
                    {/* Repeat Mode Selection */}
                    <div className="flex flex-col sm:flex-row gap-3">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="radio"
                          name="repeatMode"
                          value="weeks"
                          checked={repeatMode === 'weeks'}
                          onChange={(e) => setRepeatMode(e.target.value as 'weeks' | 'date')}
                          className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500 cursor-pointer"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">End after number of weeks</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="radio"
                          name="repeatMode"
                          value="date"
                          checked={repeatMode === 'date'}
                          onChange={(e) => setRepeatMode(e.target.value as 'weeks' | 'date')}
                          className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500 cursor-pointer"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">End on a specific date</span>
                      </label>
                    </div>
                    
                    {/* Weeks Input */}
                    {repeatMode === 'weeks' && (
                      <div className="space-y-2">
                        <label className="block text-sm text-gray-600 dark:text-gray-400">
                          Repeat for:
                        </label>
                        <div className="flex items-center space-x-3">
                          <input
                            type="number"
                            min="1"
                            max="52"
                            value={repeatWeeks}
                            onChange={(e) => {
                              const value = parseInt(e.target.value);
                              if (!isNaN(value) && value > 0) {
                                setRepeatWeeks(Math.min(52, Math.max(1, value)));
                              }
                            }}
                            className="w-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            weeks
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Events will repeat every week for the specified number of weeks
                        </p>
                      </div>
                    )}
                    
                    {/* End Date Input */}
                    {repeatMode === 'date' && (
                      <div className="space-y-2">
                        <label className="block text-sm text-gray-600 dark:text-gray-400">
                          Repeat until:
                        </label>
                        <input
                          type="date"
                          value={repeatUntilDate}
                          onChange={(e) => setRepeatUntilDate(e.target.value)}
                          min={new Date().toISOString().split('T')[0]}
                          className="w-full sm:w-auto px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Events will repeat every week until the selected date
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Convert Button */}
              <button
                onClick={handleConvert}
                disabled={isConvertDisabled}
                className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-semibold py-4 px-6 rounded-lg transition-colors flex items-center justify-center space-x-2 touch-manipulation min-h-[52px] text-base sm:text-lg"
              >
                {isProcessing ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    <span>
                      {destination === 'download' ? 'Analyzing schedules...' : 'Syncing schedules...'}{' '}
                      {processingProgress > 0 ? `${Math.round(processingProgress)}%` : ''}
                      {elapsedSeconds > 0 ? ` · ${elapsedSeconds}s` : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                    <span>
                      {!canUseSelectedDestination
                        ? `Connect ${destination === 'google' ? 'Google' : 'Outlook'} to Continue`
                        : destination === 'download'
                        ? 'Convert & Download Calendar'
                        : `Convert & Sync to ${
                            destination === 'google' ? 'Google' : 'Outlook'
                          }`}
                    </span>
                  </>
                )}
              </button>

              {isProcessing && (
                <p className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
                  Reading your schedule can take up to 3 minutes for a multi-page PDF.
                  Keep this tab open.
                </p>
              )}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mt-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}
          {statusMessage && (
            <div className="mt-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200 px-4 py-3 rounded-lg">
              {statusMessage}
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-4 sm:p-6 md:p-8">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-3 sm:mb-4">
            How it works
          </h2>
          {isMobile ? (
            <>
              <ol className="space-y-2 sm:space-y-3 text-sm sm:text-base text-gray-600 dark:text-gray-300 mb-4 sm:mb-6">
                <li className="flex items-start">
                  <span className="font-bold text-blue-600 dark:text-blue-400 mr-3">1.</span>
                  <span>
                    Upload one or more clear PDFs or images of your work schedule or class
                    timetable ({MAX_FILE_MB}MB max per file)
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="font-bold text-blue-600 dark:text-blue-400 mr-3">2.</span>
                  <span>Click convert to create your calendar events</span>
                </li>
                <li className="flex items-start">
                  <span className="font-bold text-blue-600 dark:text-blue-400 mr-3">3.</span>
                  <span>Tap the downloaded .ics file to open it in Apple Calendar</span>
                </li>
                <li className="flex items-start">
                  <span className="font-bold text-blue-600 dark:text-blue-400 mr-3">4.</span>
                  <span>Tap Add All to import the events to your calendar</span>
                </li>
              </ol>
              
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 sm:p-4">
                <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2 flex items-center text-sm sm:text-base">
                  <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Mobile Calendar Sync:
                </h3>
                <p className="text-blue-800 dark:text-blue-200 text-xs sm:text-sm">
                  Events will be added to your default calendar. To sync across devices, make sure your default calendar is set to iCloud in Settings.
                </p>
              </div>
            </>
          ) : (
            <>
              <ol className="space-y-2 sm:space-y-3 text-sm sm:text-base text-gray-600 dark:text-gray-300 mb-4 sm:mb-6">
                <li className="flex items-start">
                  <span className="font-bold text-blue-600 dark:text-blue-400 mr-3">1.</span>
                  <span>
                    Upload one or more clear PDFs or images of your work schedule or class
                    timetable ({MAX_FILE_MB}MB max per file)
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="font-bold text-blue-600 dark:text-blue-400 mr-3">2.</span>
                  <span>Choose download (.ics) or native Google/Outlook sync</span>
                </li>
                <li className="flex items-start">
                  <span className="font-bold text-blue-600 dark:text-blue-400 mr-3">3.</span>
                  <span>If you chose download, import the .ics file (instructions below)</span>
                </li>
              </ol>
              
              <div className="space-y-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 sm:p-4">
                  <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2 flex items-center text-sm sm:text-base">
                    <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Apple Calendar (Mac):
                  </h3>
                  <p className="text-blue-800 dark:text-blue-200 text-xs sm:text-sm mb-2">
                    Double-click the downloaded .ics file. It will automatically open in Calendar and ask you to confirm adding the events.
                  </p>
                  <p className="text-blue-800 dark:text-blue-200 text-xs sm:text-sm">
                    <strong>Tip:</strong> Select your <strong>iCloud</strong> calendar (not On My Mac) from the calendar dropdown to sync across all your Apple devices.
                  </p>
                </div>
                
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 sm:p-4">
                  <h3 className="font-semibold text-green-900 dark:text-green-100 mb-2 flex items-center text-sm sm:text-base">
                    <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    Google Calendar:
                  </h3>
                  <ol className="text-green-800 dark:text-green-200 text-xs sm:text-sm space-y-1 list-decimal list-inside">
                    <li>Go to <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" className="underline font-medium">calendar.google.com</a></li>
                    <li>Click the gear icon (⚙️) in the top right and select Settings</li>
                    <li>In the left sidebar, click Import &amp; export</li>
                    <li>Click Select file from your computer and choose the downloaded .ics file</li>
                    <li>Select which calendar to add the events to, then click Import</li>
                  </ol>
                </div>
                
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-3 sm:p-4">
                  <h3 className="font-semibold text-purple-900 dark:text-purple-100 mb-2 flex items-center text-sm sm:text-base">
                    <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M7.5 21H2V9h5.5v12zm7.25-18h-5.5C8.57 3 7.5 4.57 7.5 6.75V21H13V9.75h2.25V21h3.75V9.75h2.25V21H22V9.75C22 7.57 20.93 3 16.75 3z" />
                    </svg>
                    Outlook Calendar:
                  </h3>
                  <ol className="text-purple-800 dark:text-purple-200 text-xs sm:text-sm space-y-1 list-decimal list-inside">
                    <li>Open Outlook (desktop app or web at <a href="https://outlook.live.com" target="_blank" rel="noopener noreferrer" className="underline font-medium">outlook.live.com</a>)</li>
                    <li>Go to File → Open &amp; Export → Import/Export (desktop) or Settings → View all Outlook settings → Calendar → Shared calendars → Import calendar (web)</li>
                    <li>Select Import an iCalendar (.ics) or vCalendar file and click Next</li>
                    <li>Browse and select the downloaded .ics file, then click OK</li>
                    <li>The events will be imported to your default calendar</li>
                  </ol>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
