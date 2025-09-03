'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from './button';
import { Download, Copy, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

interface QRCodeProps {
  value: string;
  size?: number;
  className?: string;
  showDownload?: boolean;
  showCopy?: boolean;
  alt?: string;
}

export function QRCodeComponent({ 
  value, 
  size = 200, 
  className = '', 
  showDownload = true,
  showCopy = true,
  alt = 'QR Code'
}: QRCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const generateQR = async () => {
      if (!canvasRef.current || !value) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        await QRCode.toCanvas(canvasRef.current, value, {
          width: size,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });
        setIsLoading(false);
      } catch (err) {
        console.error('QR Code generation error:', err);
        setError('Failed to generate QR code');
        setIsLoading(false);
      }
    };

    generateQR();
  }, [value, size]);

  const handleDownload = () => {
    if (!canvasRef.current) return;
    
    try {
      const link = document.createElement('a');
      link.download = `qr-code-${Date.now()}.png`;
      link.href = canvasRef.current.toDataURL();
      link.click();
      toast.success('QR code downloaded');
    } catch (err) {
      console.error('Download error:', err);
      toast.error('Failed to download QR code');
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy error:', err);
      toast.error('Failed to copy link');
    }
  };

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 rounded-lg ${className}`} style={{ width: size, height: size }}>
        <p className="text-sm text-red-600 text-center px-4">{error}</p>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="relative flex items-center justify-center">
        {isLoading && (
          <div 
            className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-lg"
            style={{ width: size, height: size }}
          >
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        )}
        <canvas 
          ref={canvasRef}
          className={`rounded-lg border ${isLoading ? 'invisible' : 'visible'}`}
          aria-label={alt}
        />
      </div>
      
      {(showDownload || showCopy) && (
        <div className="flex justify-center gap-2">
          {showCopy && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={copied}
            >
              {copied ? (
                <CheckCircle className="w-4 h-4 mr-2" />
              ) : (
                <Copy className="w-4 h-4 mr-2" />
              )}
              {copied ? 'Copied!' : 'Copy Link'}
            </Button>
          )}
          
          {showDownload && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={isLoading}
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          )}
        </div>
      )}
    </div>
  );
}