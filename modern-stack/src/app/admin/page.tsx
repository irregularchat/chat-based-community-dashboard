'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { DashboardStatsSkeleton, ChartSkeleton } from '@/components/ui/skeleton';
import { 
  ArrowLeft, 
  Users, 
  Shield, 
  Activity, 
  TrendingUp, 
  CheckCircle, 
  Clock, 
  Download,
  RefreshCw,
  PieChart,
  Search,
  Filter,
  Settings,
  Phone
} from 'lucide-react';
import { toast } from 'sonner';

export default function AdminDashboard() {
  const { data: session } = useSession();
  const router = useRouter();
  const [selectedTimeRange, setSelectedTimeRange] = useState('7d');
  const [eventSearch, setEventSearch] = useState('');
  const [selectedEventType, setSelectedEventType] = useState('all');
  const [eventsPage, setEventsPage] = useState(1);

  // Fetch dashboard data
  const { data: overview, isLoading: overviewLoading, refetch: refetchOverview } = trpc.admin.getDashboardOverview.useQuery();
  const { data: registrationTrends, isLoading: trendsLoading } = trpc.admin.getUserRegistrationTrends.useQuery();
  const { data: systemHealth, isLoading: healthLoading } = trpc.admin.getSystemHealth.useQuery();
  const { data: eventDistribution, isLoading: distributionLoading } = trpc.admin.getEventTypeDistribution.useQuery();
  const { data: activeUsers, isLoading: activeUsersLoading } = trpc.admin.getMostActiveUsers.useQuery({
    limit: 10,
    days: 30,
  });
  const { data: adminEvents, isLoading: eventsLoading } = trpc.admin.getAdminEvents.useQuery({
    page: eventsPage,
    limit: 20,
    eventType: selectedEventType === 'all' ? undefined : selectedEventType,
    username: eventSearch || undefined,
  });

  // Export functionality
  const [exportType, setExportType] = useState<'users' | 'events' | 'matrix' | 'invites' | null>(null);
  const { data: exportData, isLoading: isExporting, error: exportError } = trpc.admin.exportAdminData.useQuery(
    { type: exportType! },
    {
      enabled: exportType !== null,
    }
  );

  // Handle export success/error
  useEffect(() => {
    if (exportData && exportType) {
      toast.success('Data exported successfully');
      console.log('Exported data:', exportData);
      setExportType(null);
    }
  }, [exportData, exportType]);

  useEffect(() => {
    if (exportError) {
      toast.error('Failed to export data');
      setExportType(null);
    }
  }, [exportError]);

  const handleExport = (type: 'users' | 'events' | 'matrix' | 'invites') => {
    setExportType(type);
  };

  // Access control
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Please sign in to access the admin dashboard</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!session.user.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You need administrator privileges to access this page</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => router.push('/')}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Dashboard
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
                <p className="text-sm text-gray-600">System analytics and administration tools</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => router.push('/admin/signal')}
              >
                <Phone className="w-4 h-4 mr-2" />
                Signal CLI
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push('/admin/configuration')}
              >
                <Settings className="w-4 h-4 mr-2" />
                Configuration
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push('/admin/settings')}
              >
                Dashboard Settings
              </Button>
              <Button
                variant="outline"
                onClick={() => refetchOverview()}
                disabled={overviewLoading}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
              <Select value={selectedTimeRange} onValueChange={setSelectedTimeRange}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="flex w-full overflow-x-auto lg:grid lg:grid-cols-5 lg:overflow-x-visible">
            <TabsTrigger value="overview" className="flex-shrink-0">Overview</TabsTrigger>
            <TabsTrigger value="users" className="flex-shrink-0">Users</TabsTrigger>
            <TabsTrigger value="activity" className="flex-shrink-0">Activity</TabsTrigger>
            <TabsTrigger value="system" className="flex-shrink-0">System Health</TabsTrigger>
            <TabsTrigger value="events" className="flex-shrink-0">Event Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {overviewLoading ? (
              <div className="space-y-6">
                <DashboardStatsSkeleton />
                <div className="grid gap-6 md:grid-cols-2">
                  <ChartSkeleton />
                  <ChartSkeleton />
                </div>
                <ChartSkeleton />
              </div>
            ) : (
              <>
                {/* Key Metrics */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{overview?.users.total || 0}</div>
                      <p className="text-xs text-muted-foreground">
                        +{overview?.users.newThisMonth || 0} this month
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Active Users</CardTitle>
                      <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{overview?.users.active || 0}</div>
                      <p className="text-xs text-muted-foreground">
                        {overview?.users.recentLogins || 0} recent logins
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Matrix Rooms</CardTitle>
                      <Shield className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{overview?.matrix.totalRooms || 0}</div>
                      <p className="text-xs text-muted-foreground">
                        {overview?.matrix.totalUsers || 0} Matrix users
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Admin Events</CardTitle>
                      <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{overview?.activity.totalEvents || 0}</div>
                      <p className="text-xs text-muted-foreground">
                        {overview?.activity.recentEvents || 0} recent events
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts */}
                <div className="grid gap-6 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="w-5 h-5" />
                        User Registration Trends
                      </CardTitle>
                      <CardDescription>Daily user registrations over the last 30 days</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {trendsLoading ? (
                        <div className="text-center py-8">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 mx-auto mb-2"></div>
                          <p className="text-sm text-gray-600">Loading trends...</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="text-center text-sm text-gray-600">
                            Simple trend visualization (real charts would use a library like Chart.js)
                          </div>
                          <div className="grid grid-cols-7 gap-1">
                            {registrationTrends?.slice(-7).map((trend, index) => (
                              <div key={index} className="text-center">
                                <div className="text-xs text-gray-500 mb-1">
                                  {new Date(trend.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </div>
                                <div 
                                  className="bg-blue-500 rounded-sm w-full"
                                  style={{
                                    height: `${Math.max(4, trend.count * 8)}px`,
                                    minHeight: '4px'
                                  }}
                                />
                                <div className="text-xs font-medium mt-1">{trend.count}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <PieChart className="w-5 h-5" />
                        Event Type Distribution
                      </CardTitle>
                      <CardDescription>Breakdown of admin events by type (last 7 days)</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {distributionLoading ? (
                        <div className="text-center py-8">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 mx-auto mb-2"></div>
                          <p className="text-sm text-gray-600">Loading distribution...</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {eventDistribution?.map((item, index) => (
                            <div key={index} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div 
                                  className="w-3 h-3 rounded-full"
                                  style={{
                                    backgroundColor: `hsl(${index * 60}, 70%, 50%)`
                                  }}
                                />
                                <span className="text-sm font-medium">{item.eventType}</span>
                              </div>
                              <Badge variant="outline">{item.count}</Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="users" className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>User Statistics</CardTitle>
                  <CardDescription>Overview of user base and activity</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Total Users</span>
                      <Badge variant="outline">{overview?.users.total || 0}</Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Active Users</span>
                      <Badge variant="default">{overview?.users.active || 0}</Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Administrators</span>
                      <Badge variant="destructive">{overview?.users.admins || 0}</Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Moderators</span>
                      <Badge variant="secondary">{overview?.users.moderators || 0}</Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">New This Week</span>
                      <Badge variant="outline">{overview?.users.newThisWeek || 0}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Most Active Users</CardTitle>
                  <CardDescription>Users with highest activity (last 30 days)</CardDescription>
                </CardHeader>
                <CardContent>
                  {activeUsersLoading ? (
                    <div className="text-center py-4">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 mx-auto mb-2"></div>
                      <p className="text-sm text-gray-600">Loading active users...</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {activeUsers?.map((user, index) => (
                        <div key={index} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                              {index + 1}
                            </div>
                            <span className="text-sm font-medium">{user.username}</span>
                          </div>
                          <Badge variant="outline">{user.count} events</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Export User Data</CardTitle>
                <CardDescription>Export user data for reporting and analysis</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handleExport('users')}
                    disabled={isExporting}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export Users
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleExport('invites')}
                    disabled={isExporting}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export Invites
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity" className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Activity Overview</CardTitle>
                  <CardDescription>System activity and engagement metrics</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Total Events</span>
                      <Badge variant="outline">{overview?.activity.totalEvents || 0}</Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Recent Events (7 days)</span>
                      <Badge variant="default">{overview?.activity.recentEvents || 0}</Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">User Notes</span>
                      <Badge variant="secondary">{overview?.activity.totalNotes || 0}</Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Active Invites</span>
                      <Badge variant="outline">{overview?.invites.active || 0}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Export Activity Data</CardTitle>
                  <CardDescription>Export activity logs and event data</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleExport('events')}
                      disabled={isExporting}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Export Events
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleExport('matrix')}
                      disabled={isExporting}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Export Matrix Data
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="system" className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    User Health
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {healthLoading ? (
                    <div className="text-center py-4">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 mx-auto mb-2"></div>
                      <p className="text-sm text-gray-600">Loading health data...</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Total Users</span>
                        <Badge variant="outline">{systemHealth?.userHealth.totalUsers || 0}</Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Active Users</span>
                        <Badge variant="default">{systemHealth?.userHealth.activeUsers || 0}</Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Active Rate</span>
                        <Badge variant="outline">
                          {systemHealth?.userHealth.activePercentage?.toFixed(1) || 0}%
                        </Badge>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-blue-500" />
                    Activity Health
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {healthLoading ? (
                    <div className="text-center py-4">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 mx-auto mb-2"></div>
                      <p className="text-sm text-gray-600">Loading activity data...</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Recent Logins</span>
                        <Badge variant="default">{systemHealth?.activityHealth.recentLogins || 0}</Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Recent Errors</span>
                        <Badge variant="destructive">{systemHealth?.activityHealth.recentErrors || 0}</Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Error Rate</span>
                        <Badge variant="outline">
                          {systemHealth?.activityHealth.errorRate?.toFixed(1) || 0}%
                        </Badge>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-purple-500" />
                    Matrix Health
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {healthLoading ? (
                    <div className="text-center py-4">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 mx-auto mb-2"></div>
                      <p className="text-sm text-gray-600">Loading Matrix data...</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Recently Synced</span>
                        <Badge variant="default">{systemHealth?.matrixHealth.recentlySynced || 0}</Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Status</span>
                        <Badge variant={systemHealth?.matrixHealth.status === 'healthy' ? 'default' : 'destructive'}>
                          {systemHealth?.matrixHealth.status || 'unknown'}
                        </Badge>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="events" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Event Logs</CardTitle>
                <CardDescription>Search and filter admin events</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 mb-6">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by username..."
                      className="pl-8"
                      value={eventSearch}
                      onChange={(e) => setEventSearch(e.target.value)}
                    />
                  </div>
                  <Select value={selectedEventType} onValueChange={setSelectedEventType}>
                    <SelectTrigger className="w-[200px]">
                      <Filter className="w-4 h-4 mr-2" />
                      <SelectValue placeholder="All event types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All event types</SelectItem>
                      <SelectItem value="user_login">User Login</SelectItem>
                      <SelectItem value="user_logout">User Logout</SelectItem>
                      <SelectItem value="user_created">User Created</SelectItem>
                      <SelectItem value="user_updated">User Updated</SelectItem>
                      <SelectItem value="user_deleted">User Deleted</SelectItem>
                      <SelectItem value="matrix_message">Matrix Message</SelectItem>
                      <SelectItem value="matrix_invite">Matrix Invite</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {eventsLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
                    <p>Loading events...</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {adminEvents?.events.map((event) => (
                      <div key={event.id} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{event.eventType}</Badge>
                            <span className="text-sm font-medium">{event.username}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            <Clock className="w-4 h-4" />
                            {new Date(event.timestamp).toLocaleString()}
                          </div>
                        </div>
                        <p className="text-sm text-gray-600">{event.details}</p>
                      </div>
                    ))}

                    {adminEvents && adminEvents.totalPages > 1 && (
                      <div className="flex items-center justify-center gap-2 mt-6">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEventsPage(eventsPage - 1)}
                          disabled={eventsPage === 1}
                        >
                          Previous
                        </Button>
                        <span className="text-sm">
                          Page {eventsPage} of {adminEvents.totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEventsPage(eventsPage + 1)}
                          disabled={eventsPage === adminEvents.totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
} 