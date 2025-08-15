'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger 
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  HelpCircle, 
  Search, 
  Zap,
  Copy,
  CheckCircle
} from 'lucide-react';
import { getSearchSuggestions, getFieldDescriptions } from '@/lib/advanced-search';
import { cn } from '@/lib/utils';

interface SearchHelpProps {
  onSuggestionClick?: (suggestion: string) => void;
  className?: string;
}

export default function SearchHelp({ onSuggestionClick, className }: SearchHelpProps) {
  const [copiedSuggestion, setCopiedSuggestion] = useState<string | null>(null);
  const suggestions = getSearchSuggestions();
  const fieldDescriptions = getFieldDescriptions();

  const handleCopySuggestion = async (suggestion: string) => {
    await navigator.clipboard.writeText(suggestion);
    setCopiedSuggestion(suggestion);
    setTimeout(() => setCopiedSuggestion(null), 2000);
  };

  const handleSuggestionClick = (suggestion: string) => {
    onSuggestionClick?.(suggestion);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={cn("h-8 w-8 p-0", className)}>
          <HelpCircle className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="end">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            <h4 className="font-semibold">Advanced Search Help</h4>
          </div>
          
          <Separator />

          {/* Quick Examples */}
          <div>
            <h5 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Zap className="h-3 w-3" />
              Quick Examples
            </h5>
            <div className="h-32 overflow-y-auto">
              <div className="space-y-1">
                {suggestions.map((suggestion, index) => (
                  <div 
                    key={index}
                    className="flex items-center justify-between p-2 rounded hover:bg-muted/50 group"
                  >
                    <code 
                      className="text-xs bg-muted px-2 py-1 rounded flex-1 cursor-pointer hover:bg-muted/80"
                      onClick={() => handleSuggestionClick(suggestion)}
                    >
                      {suggestion}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 ml-2"
                      onClick={() => handleCopySuggestion(suggestion)}
                    >
                      {copiedSuggestion === suggestion ? (
                        <CheckCircle className="h-3 w-3 text-green-600" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Separator />

          {/* Search Fields */}
          <div>
            <h5 className="text-sm font-medium mb-2">Search Fields</h5>
            <div className="space-y-2">
              {Object.entries(fieldDescriptions).map(([field, description]) => (
                <div key={field} className="flex items-start gap-2">
                  <Badge variant="outline" className="text-xs font-mono">
                    {field}
                  </Badge>
                  <span className="text-xs text-muted-foreground flex-1">
                    {description}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Boolean Operators */}
          <div>
            <h5 className="text-sm font-medium mb-2">Boolean Operators</h5>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="text-xs font-mono">AND</Badge>
                <span className="text-xs text-muted-foreground flex-1">
                  All conditions must match
                </span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="text-xs font-mono">OR</Badge>
                <span className="text-xs text-muted-foreground flex-1">
                  Any condition can match
                </span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="text-xs font-mono">NOT</Badge>
                <span className="text-xs text-muted-foreground flex-1">
                  Exclude matching results
                </span>
              </div>
            </div>
          </div>

          <Separator />

          {/* Tips */}
          <div>
            <h5 className="text-sm font-medium mb-2">Tips</h5>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Use quotes for exact phrases: <code className="bg-muted px-1 rounded">&quot;John Smith&quot;</code></li>
              <li>• Combine conditions: <code className="bg-muted px-1 rounded">user:admin AND active:true</code></li>
              <li>• Search email domains: <code className="bg-muted px-1 rounded">email:gmail.com</code></li>
              <li>• Boolean values: <code className="bg-muted px-1 rounded">active:true</code> or <code className="bg-muted px-1 rounded">admin:false</code></li>
            </ul>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
} 