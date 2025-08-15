import * as React from "react"
import { ChevronRight, Home } from "lucide-react"
import Link from "next/link"

import { cn } from "@/lib/utils"

export interface BreadcrumbItem {
  label: string
  href?: string
  current?: boolean
}

interface BreadcrumbProps {
  items: BreadcrumbItem[]
  separator?: React.ReactNode
  showHome?: boolean
  className?: string
}

export function Breadcrumb({ 
  items, 
  separator = <ChevronRight className="h-4 w-4 text-gray-400" />, 
  showHome = true,
  className 
}: BreadcrumbProps) {
  const allItems = showHome 
    ? [{ label: "Home", href: "/", current: false }, ...items]
    : items

  return (
    <nav className={cn("flex", className)} aria-label="Breadcrumb">
      <ol className="flex items-center space-x-2">
        {allItems.map((item, index) => (
          <li key={index} className="flex items-center">
            {index > 0 && (
              <span className="mx-2 flex-shrink-0" aria-hidden="true">
                {separator}
              </span>
            )}
            
            {item.href && !item.current ? (
              <Link
                href={item.href}
                className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
              >
                {index === 0 && showHome && <Home className="h-4 w-4" />}
                {item.label}
              </Link>
            ) : (
              <span
                className={cn(
                  "text-sm font-medium flex items-center gap-1",
                  item.current 
                    ? "text-gray-900" 
                    : "text-gray-500"
                )}
                aria-current={item.current ? "page" : undefined}
              >
                {index === 0 && showHome && <Home className="h-4 w-4" />}
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

// Hook to generate breadcrumbs from pathname
export function useBreadcrumbs(pathname: string): BreadcrumbItem[] {
  return React.useMemo(() => {
    const segments = pathname.split('/').filter(Boolean)
    
    const breadcrumbs: BreadcrumbItem[] = segments.map((segment, index) => {
      const href = '/' + segments.slice(0, index + 1).join('/')
      const isLast = index === segments.length - 1
      
      // Capitalize and format segment
      const label = segment
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      
      return {
        label,
        href: isLast ? undefined : href,
        current: isLast,
      }
    })
    
    return breadcrumbs
  }, [pathname])
}

// Page header component with breadcrumbs
interface PageHeaderProps {
  title: string
  description?: string
  breadcrumbs?: BreadcrumbItem[]
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({ 
  title, 
  description, 
  breadcrumbs, 
  actions, 
  className 
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-4 pb-6 border-b border-gray-200", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb items={breadcrumbs} />
      )}
      
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            {title}
          </h1>
          {description && (
            <p className="text-gray-600">
              {description}
            </p>
          )}
        </div>
        
        {actions && (
          <div className="flex items-center space-x-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}