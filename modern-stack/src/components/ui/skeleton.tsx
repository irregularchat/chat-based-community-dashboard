import { cn } from "@/lib/utils"

type SkeletonProps = React.HTMLAttributes<HTMLDivElement>

function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

// Specialized skeleton components for common patterns
function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-6 py-4">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  )
}

function CardSkeleton() {
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
      <div className="space-y-3">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
      <div className="space-y-4">
        <Skeleton className="h-6 w-1/4" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center space-x-2">
              <Skeleton className="h-3 w-12" />
              <Skeleton className={`h-6 ${i === 0 ? 'w-full' : i === 1 ? 'w-3/4' : i === 2 ? 'w-1/2' : i === 3 ? 'w-1/3' : 'w-1/4'}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function UserListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center space-x-4 p-4 border rounded-lg">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  )
}

function TimelineSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex space-x-4">
          <div className="flex flex-col items-center">
            <Skeleton className="h-3 w-3 rounded-full" />
            {i < count - 1 && <Skeleton className="h-16 w-px mt-2" />}
          </div>
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

function DashboardStatsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
          <div className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-4" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

function TabsSkeleton({ tabCount = 4 }: { tabCount?: number }) {
  return (
    <div className="space-y-4">
      <div className="flex space-x-1 border-b">
        {Array.from({ length: tabCount }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-24 rounded-t-md" />
        ))}
      </div>
      <div className="p-4 space-y-4">
        <Skeleton className="h-6 w-1/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  )
}

function FormSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <div className="flex space-x-2">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-20" />
      </div>
    </div>
  )
}

export { 
  Skeleton, 
  TableRowSkeleton, 
  CardSkeleton, 
  ChartSkeleton, 
  UserListSkeleton, 
  TimelineSkeleton, 
  DashboardStatsSkeleton, 
  TabsSkeleton, 
  FormSkeleton 
}