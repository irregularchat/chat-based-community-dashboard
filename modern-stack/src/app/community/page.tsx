'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TimelineSkeleton } from '@/components/ui/skeleton';
import { 
  Search, 
  Filter, 
  Activity, 
  Users, 
  TrendingUp, 
  Clock,
  BarChart3
} from 'lucide-react';

export default function CommunityTimelinePage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [eventType] = useState<string>('');
  const [limit] = useState(25);

  const { data: timelineData, isLoading, refetch, error } = trpc.community.getTimeline.useQuery({
    page,
    limit,
    category: category === 'all' ? undefined : category,
    eventType: eventType || undefined,
    username: search || undefined,
  });

  const { data: stats } = trpc.community.getStats.useQuery({
    days: 7,
  });

  const { data: categories } = trpc.community.getCategories.useQuery();

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatRelativeTime = (date: Date | string) => {
    const now = new Date();
    const eventDate = new Date(date);
    const diffInSeconds = Math.floor((now.getTime() - eventDate.getTime()) / 1000);

    if (diffInSeconds < 60) {
      return 'Just now';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes}m ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours}h ago`;
    } else {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days}d ago`;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'user_management':
        return 'bg-blue-100 text-blue-800';
      case 'authentication':
        return 'bg-green-100 text-green-800';
      case 'messaging':
        return 'bg-purple-100 text-purple-800';
      case 'matrix':
        return 'bg-orange-100 text-orange-800';
      case 'permissions':
        return 'bg-red-100 text-red-800';
      case 'system':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Activity className="w-8 h-8" />
            Community Timeline
          </h1>
          <p className="text-gray-600 mt-2">
            Public record of community events and administrative actions
          </p>
        </div>
        <Tabs defaultValue="timeline" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="timeline" className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Timeline
            </TabsTrigger>
            <TabsTrigger value="stats" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Statistics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="timeline">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Recent Community Events
                  {timelineData && (
                    <Badge variant="secondary">
                      {timelineData.total} total events
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Real-time feed of community activities and administrative actions for transparency
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-4 mb-6">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by username..."
                      className="pl-8"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="w-[180px]">
                      <Filter className="w-4 h-4 mr-2" />
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories?.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    onClick={() => refetch()}
                  >
                    <Search className="w-4 h-4 mr-2" />
                    Search
                  </Button>
                </div>

                {/* Timeline Events */}
                {error ? (
                  <div className="text-center py-8 text-red-500">
                    <p>Error loading timeline: {error.message}</p>
                    <button 
                      onClick={() => refetch()}
                      className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      Retry
                    </button>
                  </div>
                ) : isLoading ? (
                  <TimelineSkeleton count={5} />
                ) : (
                  <div className="space-y-4">
                    {timelineData?.events?.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        No events found matching the current filters.
                      </div>
                    ) : (
                      timelineData?.events?.map((event) => (
                        <div key={event.id} className="border rounded-lg p-4 bg-white hover:bg-gray-50 transition-colors">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <div className="text-lg">{event.details.split(' ')[0]}</div>
                                <div className="font-medium text-gray-900">
                                  @{event.username}
                                </div>
                                {event.category && (
                                  <Badge className={getCategoryColor(event.category)}>
                                    {event.category.replace('_', ' ')}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-gray-700 mb-2">
                                {event.details.substring(event.details.indexOf(' ') + 1)}
                              </div>
                              <div className="flex items-center gap-4 text-sm text-gray-500">
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {formatRelativeTime(event.timestamp)}
                                </span>
                                <span>{formatDate(event.timestamp)}</span>
                                <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                                  {event.eventType}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Pagination */}
                {timelineData && timelineData.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-6">
                    <div className="text-sm text-gray-700">
                      Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, timelineData.total)} of {timelineData.total} events
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(Math.max(1, page - 1))}
                        disabled={page === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-sm text-gray-600">
                        Page {page} of {timelineData.totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(Math.min(timelineData.totalPages, page + 1))}
                        disabled={page === timelineData.totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stats">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {/* Overall Stats */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Events</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.totalEvents || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    All recorded community events
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.recentEvents || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    Events in the last 7 days
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Event Types</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.eventsByType?.length || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    Different event types this week
                  </p>
                </CardContent>
              </Card>

              {/* Event Types Breakdown */}
              <Card className="md:col-span-2 lg:col-span-3">
                <CardHeader>
                  <CardTitle>Most Common Events (Last 7 Days)</CardTitle>
                  <CardDescription>
                    Breakdown of community activity by event type
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {stats?.eventsByType?.length === 0 ? (
                    <div className="text-center py-6 text-gray-500">
                      No events recorded in the last 7 days.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {stats?.eventsByType?.map((item, index) => (
                        <div key={item.eventType} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="text-lg">{item.emoji}</div>
                            <div>
                              <div className="font-medium">
                                {item.eventType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                              </div>
                              <div className="text-sm text-gray-600">
                                {item.count} event{item.count !== 1 ? 's' : ''}
                              </div>
                            </div>
                          </div>
                          <Badge variant="secondary">
                            #{index + 1}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
} 