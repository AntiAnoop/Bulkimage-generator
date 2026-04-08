import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Zap, 
  Download, 
  Image as ImageIcon, 
  List, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Trash2,
  FileArchive,
  Key,
  BarChart3,
  Info
} from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { generateImage } from './lib/gemini';
import { cn } from './lib/utils';

const DAILY_LIMIT = 500;
const STORAGE_KEY_API = 'bulkimagezip_api_key';
const STORAGE_KEY_QUOTA = 'bulkimagezip_quota_usage';

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY_API) || '');
  const [isKeySaved, setIsKeySaved] = useState(!!localStorage.getItem(STORAGE_KEY_API));
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ success?: boolean; message?: string } | null>(null);

  const [quotaUsage, setQuotaUsage] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_QUOTA);
    if (saved) {
      const { count, date } = JSON.parse(saved);
      const today = new Date().toISOString().split('T')[0];
      if (date === today) return count;
    }
    return 0;
  });

  const saveApiKey = () => {
    localStorage.setItem(STORAGE_KEY_API, apiKey);
    setIsKeySaved(true);
    setTestResult({ success: true, message: 'Key saved successfully!' });
    setTimeout(() => setTestResult(null), 3000);
  };

  const testApiKey = async () => {
    if (!apiKey) return;
    setIsTestingKey(true);
    setTestResult(null);
    try {
      const result = await generateImage("Test prompt for API key validation", apiKey, 1);
      if (result.dataUrl) {
        setTestResult({ success: true, message: 'Connection successful! Your key is working.' });
        saveApiKey();
      } else {
        setTestResult({ success: false, message: `Failed: ${result.error || 'Unknown error'}` });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: `Error: ${err.message || 'Connection failed'}` });
    } finally {
      setIsTestingKey(false);
    }
  };

  const [promptsText, setPromptsText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [status, setStatus] = useState<'idle' | 'processing' | 'completed' | 'error'>('idle');
  const [results, setResults] = useState<{ prompt: string; success: boolean; error?: string }[]>([]);
  const [failedPrompts, setFailedPrompts] = useState<string[]>([]);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // We only save via the Save button now to give user control
  }, [apiKey]);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem(STORAGE_KEY_QUOTA, JSON.stringify({ count: quotaUsage, date: today }));
  }, [quotaUsage]);

  const parsePrompts = (text: string): string[] => {
    const labelRegex = /(?:^|\n)\s*(?:Prompt\s*[-:]?\s*\d+\s*[:.-]?|\d+\s*[:.-])\s*/gi;
    if (labelRegex.test(text)) {
      return text.split(labelRegex).map(p => p.trim()).filter(p => p.length > 0);
    }
    const blocks = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
    if (blocks.length > 1) return blocks;
    return text.split('\n').map(p => p.trim()).filter(p => p.length > 0);
  };

  const handleGenerate = async (retryOnly = false) => {
    if (!apiKey) {
      setStatus('error');
      alert('Please enter your Gemini API Key first.');
      return;
    }

    const allPrompts = parsePrompts(promptsText);
    const promptsToProcess = retryOnly ? failedPrompts : allPrompts;
    
    if (promptsToProcess.length === 0) return;

    setIsGenerating(true);
    setStatus('processing');
    setProgress({ current: 0, total: promptsToProcess.length });
    setResults([]);
    setFailedPrompts([]);

    const zip = new JSZip();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folderName = `Generated_Images_${timestamp}`;
    const imgFolder = zip.folder(folderName);

    const currentResults: { prompt: string; success: boolean; error?: string }[] = [];
    const currentFailed: string[] = [];
    let successCount = 0;

    for (let i = 0; i < promptsToProcess.length; i++) {
      const prompt = promptsToProcess[i];
      setProgress(prev => ({ ...prev, current: i + 1 }));
      
      // Stricter rate limiting: 4 seconds between requests (15 RPM max)
      if (i > 0) await new Promise(resolve => setTimeout(resolve, 4000));
      
      const { dataUrl, error, status: errStatus } = await generateImage(prompt, apiKey, 5);
      
      if (dataUrl && imgFolder) {
        const base64Data = dataUrl.split(',')[1];
        imgFolder.file(`${i + 1}.png`, base64Data, { base64: true });
        currentResults.push({ prompt, success: true });
        successCount++;
        setQuotaUsage(prev => prev + 1);
      } else {
        const isRateLimit = error === 'RATE_LIMIT_EXCEEDED' || errStatus === 429;
        currentResults.push({ 
          prompt, 
          success: false, 
          error: isRateLimit ? 'Rate limit exceeded. Pausing queue...' : (error || 'Failed to generate')
        });
        currentFailed.push(prompt);
        
        if (isRateLimit) {
          // If we hit a rate limit, wait 30s before continuing or stopping
          await new Promise(resolve => setTimeout(resolve, 30000));
        }
      }
      
      setResults([...currentResults]);
    }

    setFailedPrompts(currentFailed);

    if (successCount > 0) {
      try {
        const content = await zip.generateAsync({ 
          type: 'blob',
          compression: "DEFLATE",
          compressionOptions: { level: 6 }
        });
        saveAs(content, `${folderName}.zip`);
        setStatus(successCount === promptsToProcess.length ? 'completed' : 'error');
      } catch (err) {
        console.error("ZIP generation failed", err);
        setStatus('error');
      }
    } else {
      setStatus('error');
    }
    
    setIsGenerating(false);
  };

  const clearPrompts = () => {
    setPromptsText('');
    setStatus('idle');
    setResults([]);
  };

  const progressPercentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
  const quotaPercentage = Math.min((quotaUsage / DAILY_LIMIT) * 100, 100);

  return (
    <div className="min-h-screen flex flex-col items-center p-4 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <header className="w-full flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-neon-blue rounded-lg flex items-center justify-center neon-glow">
            <Zap className="text-dark-bg fill-dark-bg" size={24} />
          </div>
          <h1 className="text-2xl font-bold tracking-tighter">
            BulkImage<span className="text-neon-blue">Zip</span>
          </h1>
        </div>
        <div className="hidden md:flex items-center gap-4">
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-2 text-xs font-mono text-gray-400 uppercase tracking-widest">
              <BarChart3 size={14} className="text-neon-blue" />
              Daily Quota: {quotaUsage}/{DAILY_LIMIT}
            </div>
            <div className="w-32 h-1 bg-gray-800 rounded-full mt-1 overflow-hidden">
              <div 
                className={cn(
                  "h-full transition-all duration-500",
                  quotaUsage > DAILY_LIMIT * 0.9 ? "bg-red-500" : "bg-neon-blue"
                )}
                style={{ width: `${quotaPercentage}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* API Key Section */}
      <div className="w-full mb-8">
        <div className="glass-panel p-4 space-y-3">
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="flex items-center gap-3 text-gray-400 shrink-0">
              <Key size={18} className={cn(isKeySaved ? "text-green-400" : "text-neon-blue")} />
              <span className="text-sm font-medium">Gemini API Key</span>
            </div>
            <div className="relative flex-1 w-full">
              <input 
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setIsKeySaved(false);
                }}
                placeholder="Paste your API key here..."
                className={cn(
                  "w-full bg-dark-bg border rounded-lg px-4 py-2 text-sm focus:outline-none transition-all font-mono",
                  isKeySaved ? "border-green-900/30 focus:border-green-500" : "border-dark-border focus:border-neon-blue"
                )}
              />
              {isKeySaved && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] text-green-500 font-bold uppercase tracking-tighter">
                  <CheckCircle2 size={10} /> Saved
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={testApiKey}
                disabled={isTestingKey || !apiKey}
                className="px-3 py-2 rounded-lg bg-gray-800 text-xs font-bold hover:bg-gray-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isTestingKey ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                Test Connection
              </button>
              <button
                onClick={saveApiKey}
                disabled={!apiKey || isKeySaved}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                  isKeySaved ? "bg-green-600/20 text-green-500 cursor-default" : "bg-neon-blue text-dark-bg hover:scale-105 active:scale-95"
                )}
              >
                Save Key
              </button>
            </div>
            <a 
              href="https://aistudio.google.com/app/apikey" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-neon-blue hover:underline flex items-center gap-1 shrink-0 ml-auto"
            >
              Get Key <Info size={12} />
            </a>
          </div>
          
          {testResult && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "text-xs p-2 rounded border flex items-center gap-2",
                testResult.success ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400"
              )}
            >
              {testResult.success ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {testResult.message}
            </motion.div>
          )}
        </div>
      </div>

      <main className="w-full grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Input Section */}
        <section className="lg:col-span-2 space-y-6">
          <div className="glass-panel p-6 space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-gray-400">
                <List size={18} />
                <span className="text-sm font-medium">Prompt List</span>
              </div>
              <button 
                onClick={clearPrompts}
                disabled={isGenerating || !promptsText}
                className="text-gray-500 hover:text-red-400 transition-colors disabled:opacity-30"
              >
                <Trash2 size={18} />
              </button>
            </div>
            
            <textarea
              ref={textareaRef}
              value={promptsText}
              onChange={(e) => setPromptsText(e.target.value)}
              placeholder="Paste your prompts here. Supports:&#10;1. Single line prompts&#10;2. Multi-line prompts separated by double newlines&#10;3. Labeled prompts like 'Prompt 1: ... Prompt 2: ...'&#10;&#10;Example:&#10;Prompt 1:&#10;A majestic lion in the savannah&#10;with a golden sunset background&#10;&#10;Prompt 2:&#10;A futuristic neon city"
              className="w-full h-80 bg-dark-bg border border-dark-border rounded-lg p-4 font-mono text-sm focus:outline-none focus:border-neon-blue transition-colors resize-none placeholder:text-gray-700"
              disabled={isGenerating}
            />

            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-gray-500 font-mono">
                {parsePrompts(promptsText).length} Prompts Detected
              </div>
              <button
                onClick={() => handleGenerate(false)}
                disabled={isGenerating || !promptsText.trim() || !apiKey}
                className={cn(
                  "flex items-center gap-2 px-6 py-3 rounded-lg font-bold transition-all duration-300",
                  isGenerating || !promptsText.trim() || !apiKey
                    ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                    : "bg-neon-blue text-dark-bg hover:scale-105 active:scale-95 neon-glow"
                )}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    Processing...
                  </>
                ) : (
                  <>
                    <Zap size={20} fill="currentColor" />
                    Generate & Zip
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Progress Section */}
          <AnimatePresence>
            {isGenerating && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="glass-panel p-6 space-y-4 border-neon-blue/30"
              >
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-neon-blue uppercase tracking-wider">Generating Assets</h3>
                    <p className="text-xs text-gray-400">Processing image {progress.current} of {progress.total}</p>
                  </div>
                  <div className="text-2xl font-mono font-bold text-neon-blue">
                    {Math.round(progressPercentage)}%
                  </div>
                </div>
                <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-neon-blue neon-glow"
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPercentage}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Status & Results Section */}
        <aside className="space-y-6">
          <div className="glass-panel p-6 space-y-6">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">Status</h3>
            
            <div className="space-y-4">
              <StatusItem 
                icon={<ImageIcon size={18} />} 
                label="Image Generation" 
                status={status === 'completed' ? 'done' : status === 'processing' ? 'active' : 'pending'} 
              />
              <StatusItem 
                icon={<FileArchive size={18} />} 
                label="ZIP Bundling" 
                status={status === 'completed' ? 'done' : status === 'processing' && progress.current === progress.total ? 'active' : 'pending'} 
              />
              <StatusItem 
                icon={<Download size={18} />} 
                label="Auto Download" 
                status={status === 'completed' ? 'done' : 'pending'} 
              />
            </div>

            {status === 'completed' && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-start gap-3"
              >
                <CheckCircle2 className="text-green-500 shrink-0" size={20} />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-green-500">Success!</p>
                  <p className="text-xs text-gray-400">All {results.length} images have been generated and bundled into your ZIP file.</p>
                </div>
              </motion.div>
            )}

            {status === 'error' && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex flex-col gap-3"
              >
                <div className="flex items-start gap-3">
                  <AlertCircle className="text-red-500 shrink-0" size={20} />
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-red-500">Incomplete Batch</p>
                    <p className="text-xs text-gray-400">
                      Generated {results.filter(r => r.success).length} of {results.length} images. 
                      {results.some(r => r.error === 'QUOTA_EXCEEDED') ? ' Daily quota reached.' : ' Some prompts may have been blocked.'}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => handleGenerate(true)}
                  className="w-full py-2 bg-red-500/20 hover:bg-red-500/30 text-red-500 text-xs font-bold rounded transition-colors"
                >
                  Retry Failed Prompts
                </button>
              </motion.div>
            )}
          </div>

          {/* Recent Results Log */}
          {results.length > 0 && (
            <div className="glass-panel p-6 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">Activity Log</h3>
              <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                {results.slice().reverse().map((res, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs p-2 bg-dark-bg rounded border border-dark-border">
                    <span className="truncate max-w-[150px] text-gray-400">{res.prompt}</span>
                    {res.success ? (
                      <span className="text-green-500 font-mono">OK</span>
                    ) : (
                      <span className="text-red-500 font-mono" title={res.error}>FAIL</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </main>

      <footer className="mt-auto py-8 text-gray-600 text-xs font-mono">
        &copy; 2026 BULKIMAGEZIP // POWERED BY GEMINI 2.5 FLASH
      </footer>
    </div>
  );
}

function StatusItem({ icon, label, status }: { icon: React.ReactNode, label: string, status: 'pending' | 'active' | 'done' }) {
  return (
    <div className="flex items-center justify-between">
      <div className={cn(
        "flex items-center gap-3 transition-colors",
        status === 'pending' ? "text-gray-600" : "text-gray-300"
      )}>
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      {status === 'active' && <Loader2 className="text-neon-blue animate-spin" size={16} />}
      {status === 'done' && <CheckCircle2 className="text-neon-blue" size={16} />}
      {status === 'pending' && <div className="w-4 h-4 rounded-full border border-gray-700" />}
    </div>
  );
}
