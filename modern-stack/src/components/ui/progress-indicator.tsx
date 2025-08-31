import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { CheckCircle2, Circle, AlertCircle, Clock } from "lucide-react"

import { cn } from "@/lib/utils"

const progressVariants = cva(
  "flex items-center gap-3 p-3 rounded-lg border transition-colors",
  {
    variants: {
      status: {
        pending: "bg-gray-50 border-gray-200",
        in_progress: "bg-blue-50 border-blue-200",
        completed: "bg-green-50 border-green-200",
        error: "bg-red-50 border-red-200",
      },
    },
    defaultVariants: {
      status: "pending",
    },
  }
)

const iconVariants = cva("h-5 w-5", {
  variants: {
    status: {
      pending: "text-gray-400",
      in_progress: "text-blue-500 animate-pulse",
      completed: "text-green-500",
      error: "text-red-500",
    },
  },
})

type ProgressStatus = "pending" | "in_progress" | "completed" | "error"

interface ProgressStep {
  id: string
  title: string
  description?: string
  status: ProgressStatus
  error?: string
}

interface ProgressIndicatorProps extends VariantProps<typeof progressVariants> {
  steps: ProgressStep[]
  className?: string
}

const StatusIcon = ({ status }: { status: ProgressStatus }) => {
  switch (status) {
    case "pending":
      return <Circle className={iconVariants({ status })} />
    case "in_progress":
      return <Clock className={iconVariants({ status })} />
    case "completed":
      return <CheckCircle2 className={iconVariants({ status })} />
    case "error":
      return <AlertCircle className={iconVariants({ status })} />
    default:
      return <Circle className={iconVariants({ status: "pending" })} />
  }
}

export function ProgressIndicator({ steps, className }: ProgressIndicatorProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {steps.map((step, _index) => (
        <div key={step.id} className={progressVariants({ status: step.status })}>
          <StatusIcon status={step.status} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-900">{step.title}</h4>
              {step.status === "in_progress" && (
                <div className="flex space-x-1">
                  <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse" />
                  <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse delay-100" />
                  <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse delay-200" />
                </div>
              )}
            </div>
            {step.description && (
              <p className="text-xs text-gray-600 mt-1">{step.description}</p>
            )}
            {step.error && step.status === "error" && (
              <p className="text-xs text-red-600 mt-1">{step.error}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// Linear progress bar component
interface LinearProgressProps {
  value: number
  max?: number
  size?: "sm" | "md" | "lg"
  variant?: "default" | "success" | "warning" | "error"
  showLabel?: boolean
  className?: string
}

const linearProgressVariants = cva("rounded-full overflow-hidden", {
  variants: {
    size: {
      sm: "h-2",
      md: "h-3",
      lg: "h-4",
    },
    variant: {
      default: "bg-gray-200",
      success: "bg-green-100",
      warning: "bg-yellow-100", 
      error: "bg-red-100",
    },
  },
  defaultVariants: {
    size: "md",
    variant: "default",
  },
})

const linearProgressBarVariants = cva("h-full transition-all duration-300 ease-out", {
  variants: {
    variant: {
      default: "bg-blue-500",
      success: "bg-green-500",
      warning: "bg-yellow-500",
      error: "bg-red-500",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

export function LinearProgress({ 
  value, 
  max = 100, 
  size, 
  variant, 
  showLabel = false, 
  className 
}: LinearProgressProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100)
  
  return (
    <div className={cn("w-full", className)}>
      {showLabel && (
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-gray-600">Progress</span>
          <span className="text-sm font-medium text-gray-900">{Math.round(percentage)}%</span>
        </div>
      )}
      <div className={linearProgressVariants({ size, variant })}>
        <div 
          className={linearProgressBarVariants({ variant })}
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
        />
      </div>
    </div>
  )
}