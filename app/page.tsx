'use client';

import { useState, useRef, useEffect } from 'react';

interface FileWithPreview {
  file: File;
  preview: string;
  id: string;
}

export default function Home() {
  const [selectedFiles, setSelectedFiles] = useState<FileWithPreview[]>([]);
  const [format, setFormat] = useState<'outlook' | 'apple'>('apple');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState<number>(4);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFilesSelect = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const imageFiles = fileArray.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length === 0) {
      setError('Please select valid image files');
      return;
    }

    setError(null);

    // Process each file to create preview
    imageFiles.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const newFile: FileWithPreview = {
          file,
          preview: reader.result as string,
          id: `${file.name}-${Date.now()}-${Math.random()}`
        };
        setSelectedFiles(prev => [...prev, newFile]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFilesSelect(files);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFilesSelect(files);
    }
  };

  const handleConvert = async () => {
    if (selectedFiles.length === 0) {
      setError('Please select at least one image first');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProcessingProgress(0);

    try {
      // Send all images to server for AI processing
      const formData = new FormData();
      selectedFiles.forEach((fileWithPreview) => {
        formData.append('images', fileWithPreview.file);
      });
      formData.append('format', format);
      if (repeatWeekly) {
        formData.append('repeatWeekly', 'true');
        formData.append('repeatWeeks', repeatWeeks.toString());
      }

      setProcessingProgress(20);
      const response = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
      });

      setProcessingProgress(90);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to convert schedule');
      }

      setProcessingProgress(95);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schedule.ics`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setProcessingProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsProcessing(false);
      setProcessingProgress(0);
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
            Upload screenshots of your work schedule and convert them to a calendar file
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-4 sm:p-6 md:p-8 mb-6 sm:mb-8">
          {/* File Upload Area */}
          {selectedFiles.length === 0 ? (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 sm:p-12 text-center cursor-pointer hover:border-blue-500 dark:hover:border-blue-400 active:border-blue-600 transition-colors touch-manipulation"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileInputChange}
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
                Drag and drop your schedule images here
              </p>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                or tap to browse files (you can select multiple images)
              </p>
            </div>
          ) : (
            <div className="space-y-4 sm:space-y-6">
              {/* Preview Grid */}
              <div className="space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
                    Selected Images ({selectedFiles.length})
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
                      <img
                        src={fileWithPreview.preview}
                        alt={`Preview: ${fileWithPreview.file.name}`}
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 max-h-48 sm:max-h-64 object-contain bg-gray-50 dark:bg-gray-900"
                      />
                      <button
                        onClick={() => handleRemoveFile(fileWithPreview.id)}
                        className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white rounded-full p-2 sm:p-2.5 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100 touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
                        aria-label="Remove image"
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
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 text-center hover:border-blue-500 dark:hover:border-blue-400 active:border-blue-600 transition-colors text-gray-600 dark:text-gray-400 touch-manipulation min-h-[44px]"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileInputChange}
                    className="hidden"
                  />
                  + Add More Images
                </button>
              </div>

              {/* Format Selection */}
              <div className="space-y-3 sm:space-y-4">
                {isMobile ? (
                  <>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Calendar Format:
                    </label>
                    <div className="grid grid-cols-1 gap-3 sm:gap-4">
                      <button
                        className="p-3 sm:p-4 rounded-lg border-2 border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400 touch-manipulation min-h-[80px] cursor-default"
                        disabled
                      >
                        <div className="flex items-center justify-center space-x-3">
                          <svg
                            className="w-8 h-8"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                          </svg>
                          <span className="font-medium text-gray-900 dark:text-white">
                            Apple Calendar
                          </span>
                        </div>
                      </button>
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-amber-800 dark:text-amber-200 text-xs sm:text-sm">
                      <p className="font-medium mb-1">📱 Mobile Notice:</p>
                      <p>Only Apple Calendar is available on mobile devices. For Outlook or Google Calendar, please use a desktop computer.</p>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Calendar Format:
                    </label>
                    <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-3">
                      The calendar file will download as a .ics file. See instructions below for importing to Outlook or Google Calendar.
                    </p>
                  </>
                )}
              </div>

              {/* Repeat Options */}
              <div className="space-y-3 sm:space-y-4">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={repeatWeekly}
                    onChange={(e) => setRepeatWeekly(e.target.checked)}
                    className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Repeat weekly
                  </span>
                </label>
                
                {repeatWeekly && (
                  <div className="ml-8 space-y-2">
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
              </div>

              {/* Convert Button */}
              <button
                onClick={handleConvert}
                disabled={isProcessing}
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
                    <span>Analyzing schedules... {processingProgress > 0 ? `${Math.round(processingProgress)}%` : ''}</span>
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
                    <span>Convert & Download Calendar</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mt-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-3 rounded-lg">
              {error}
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
                  <span>Upload one or more clear screenshots of your work schedule</span>
                </li>
                <li className="flex items-start">
                  <span className="font-bold text-blue-600 dark:text-blue-400 mr-3">2.</span>
                  <span>Click convert and download your calendar file (.ics)</span>
                </li>
                <li className="flex items-start">
                  <span className="font-bold text-blue-600 dark:text-blue-400 mr-3">3.</span>
                  <span>Tap the downloaded .ics file to open it in Apple Calendar</span>
                </li>
                <li className="flex items-start">
                  <span className="font-bold text-blue-600 dark:text-blue-400 mr-3">4.</span>
                  <span>Tap "Add All" to import the events to your calendar</span>
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
                  <span>Upload one or more clear screenshots of your work schedule</span>
                </li>
                <li className="flex items-start">
                  <span className="font-bold text-blue-600 dark:text-blue-400 mr-3">2.</span>
                  <span>Click convert and download your calendar file (.ics)</span>
                </li>
                <li className="flex items-start">
                  <span className="font-bold text-blue-600 dark:text-blue-400 mr-3">3.</span>
                  <span>Import the .ics file to your calendar application (see instructions below)</span>
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
                    <strong>Tip:</strong> Select your <strong>iCloud</strong> calendar (not "On My Mac") from the calendar dropdown to sync across all your Apple devices.
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
                    <li>Click the gear icon (⚙️) in the top right and select "Settings"</li>
                    <li>In the left sidebar, click "Import & export"</li>
                    <li>Click "Select file from your computer" and choose the downloaded .ics file</li>
                    <li>Select which calendar to add the events to, then click "Import"</li>
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
                    <li>Go to "File" → "Open & Export" → "Import/Export" (desktop) or "Settings" → "View all Outlook settings" → "Calendar" → "Shared calendars" → "Import calendar" (web)</li>
                    <li>Select "Import an iCalendar (.ics) or vCalendar file" and click "Next"</li>
                    <li>Browse and select the downloaded .ics file, then click "OK"</li>
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
