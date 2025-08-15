import { cn } from "@/lib/utils"

interface PasswordStrengthProps {
  password: string;
  className?: string;
}

export function PasswordStrength({ password, className }: PasswordStrengthProps) {
  const getStrength = (password: string) => {
    let score = 0;
    const feedback: string[] = [];
    
    if (password.length >= 8) {
      score += 1;
    } else if (password.length >= 6) {
      score += 0.5;
      feedback.push("Use 8+ characters for better security");
    } else if (password.length > 0) {
      feedback.push("Password must be at least 6 characters");
    }
    
    if (/[a-z]/.test(password)) {
      score += 1;
    } else if (password.length > 0) {
      feedback.push("Add lowercase letters");
    }
    
    if (/[A-Z]/.test(password)) {
      score += 1;
    } else if (password.length > 0) {
      feedback.push("Add uppercase letters");
    }
    
    if (/\d/.test(password)) {
      score += 1;
    } else if (password.length > 0) {
      feedback.push("Add numbers");
    }
    
    if (/[^a-zA-Z0-9]/.test(password)) {
      score += 1;
      feedback.push("Great! Contains special characters");
    } else if (password.length > 0) {
      feedback.push("Add special characters for extra security");
    }
    
    const strength = 
      score >= 4.5 ? 'strong' : 
      score >= 3 ? 'medium' : 
      score >= 1.5 ? 'weak' : 
      'very-weak';
    
    return { strength, score, feedback };
  };

  if (!password) {
    return null;
  }

  const { strength, score, feedback } = getStrength(password);
  
  const strengthColors: Record<string, string> = {
    'very-weak': 'bg-red-500',
    'weak': 'bg-orange-500',
    'medium': 'bg-yellow-500',
    'strong': 'bg-green-500',
  };
  
  const strengthLabels: Record<string, string> = {
    'very-weak': 'Very Weak',
    'weak': 'Weak',
    'medium': 'Medium',
    'strong': 'Strong',
  };

  return (
    <div className={cn("space-y-2", className)}>
      {/* Strength bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className={cn("h-full transition-all duration-300", strengthColors[strength])}
            style={{ width: `${(score / 5) * 100}%` }}
          />
        </div>
        <span className={cn("text-xs font-medium", {
          'text-red-600': strength === 'very-weak',
          'text-orange-600': strength === 'weak', 
          'text-yellow-600': strength === 'medium',
          'text-green-600': strength === 'strong',
        })}>
          {strengthLabels[strength]}
        </span>
      </div>
      
      {/* Feedback */}
      {feedback.length > 0 && (
        <div className="space-y-1">
          {feedback.slice(0, 3).map((item, index) => (
            <div key={index} className="flex items-center gap-2 text-xs">
              <div className={cn("w-1.5 h-1.5 rounded-full", {
                'bg-red-400': item.includes('must') || item.includes('Add'),
                'bg-yellow-400': item.includes('Use'),
                'bg-green-400': item.includes('Great'),
              })} />
              <span className="text-gray-600">{item}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}