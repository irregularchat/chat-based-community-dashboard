"use client"

import * as React from "react"
import { Check, ChevronsUpDown, User } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

type MatrixUser = {
  user_id: string
  display_name: string
  avatar_url?: string
}

interface SearchableMatrixUserSelectProps {
  users: MatrixUser[]
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  emptyText?: string
  className?: string
  disabled?: boolean
}

export function SearchableMatrixUserSelect({
  users,
  value,
  onValueChange,
  placeholder = "Select Matrix user...",
  emptyText = "No Matrix users found.",
  className,
  disabled = false,
}: SearchableMatrixUserSelectProps) {
  const [open, setOpen] = React.useState(false)

  const selectedUser = users.find((user) => user.user_id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between", className)}
          disabled={disabled}
        >
          {selectedUser ? (
            <div className="flex items-center gap-2 flex-1 text-left">
              <User className="h-4 w-4 text-muted-foreground" />
              <div className="flex flex-col">
                <span className="font-medium">{selectedUser.display_name}</span>
                <span className="text-xs text-muted-foreground truncate">
                  {selectedUser.user_id}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="h-4 w-4" />
              <span>{placeholder}</span>
            </div>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput 
            placeholder="Search Matrix users..." 
            className="h-9"
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {users.map((user) => (
                <CommandItem
                  key={user.user_id}
                  value={`${user.display_name} ${user.user_id}`}
                  onSelect={() => {
                    onValueChange?.(user.user_id === value ? "" : user.user_id)
                    setOpen(false)
                  }}
                  className="gap-2"
                >
                  <User className="h-4 w-4 text-muted-foreground" />
                  <div className="flex flex-col flex-1">
                    <span className="font-medium">{user.display_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {user.user_id}
                    </span>
                  </div>
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      value === user.user_id ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}