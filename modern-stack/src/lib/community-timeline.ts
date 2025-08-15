import { prisma } from '@/lib/prisma';

export interface CommunityEventData {
  eventType: string;
  username: string;
  details: string;
  isPublic?: boolean;
  category?: string;
}

// Event type to emoji mapping (based on legacy system)
const EVENT_EMOJIS: Record<string, string> = {
  // User management
  'user_created': '👤',
  'user_updated': '✏️',
  'user_deleted': '🚫',
  'user_suspended': '⏸️',
  'user_activated': '🟢',
  'user_deactivated': '🔴',
  'user_verified': '✅',
  'user_invitation_created': '📨',
  'user_invitation_accepted': '🎉',
  
  // Authentication & Security
  'login': '🔐',
  'logout': '🚪',
  'password_reset': '🔑',
  'password_changed': '🔒',
  'phone_updated': '📱',
  'email_updated': '📧',
  'admin_granted': '👑',
  'admin_revoked': '👑',
  'moderator_promoted': '🛡️',
  'moderator_demoted': '📉',
  
  // Messaging & Communication
  'direct_message': '💬',
  'bulk_message': '📢',
  'room_message': '🏠',
  'matrix_user_connected': '🔗',
  'signal_identity_updated': '📱',
  'email_sent': '📧',
  'email_failed': '❌',
  
  // Matrix/Room Management
  'room_invitation': '📨',
  'room_creation': '🏠',
  'user_invited_to_room': '🚪',
  'user_removed_from_room': '🚫',
  'room_message_sent': '💬',
  
  // System Events
  'system_sync': '🔄',
  'bulk_operation': '📦',
  'data_export': '📤',
  'data_import': '📥',
  'backup_created': '💾',
  'system_maintenance': '🔧',
  'security_alert': '🚨',
  'configuration_changed': '⚙️',
  
  // Permissions
  'permission_granted': '✅',
  'permission_revoked': '❌',
  
  // Default
  'default': '📝'
};

// Event categories for filtering
export const EVENT_CATEGORIES = {
  USER_MANAGEMENT: 'user_management',
  AUTHENTICATION: 'authentication',
  MESSAGING: 'messaging',
  SYSTEM: 'system',
  PERMISSIONS: 'permissions',
  MATRIX: 'matrix'
} as const;

/**
 * Log a community event for transparency
 */
export async function logCommunityEvent(eventData: CommunityEventData): Promise<void> {
  try {
    // Format the details with emoji if not already formatted
    const emoji = EVENT_EMOJIS[eventData.eventType] || EVENT_EMOJIS.default;
    const formattedDetails = eventData.details.startsWith(emoji) 
      ? eventData.details 
      : `${emoji} ${eventData.details}`;

    // Skip certain system events that are too verbose
    if (eventData.eventType === 'system_sync' && 
        eventData.details.includes('Incremental sync of') && 
        eventData.details.includes('users from Authentik')) {
      return; // Skip this event
    }

    await prisma.communityEvent.create({
      data: {
        eventType: eventData.eventType,
        username: eventData.username,
        details: formattedDetails,
        isPublic: eventData.isPublic ?? true,
        category: eventData.category,
      },
    });
  } catch (error) {
    console.error('Failed to log community event:', error);
    // Don't throw - logging should not break the main functionality
  }
}

/**
 * Get community events for the timeline
 */
export async function getCommunityEvents(options: {
  limit?: number;
  offset?: number;
  category?: string;
  eventType?: string;
  username?: string;
  isPublic?: boolean;
} = {}) {
  const {
    limit = 50,
    offset = 0,
    category,
    eventType,
    username,
    isPublic = true
  } = options;

  const where: any = {
    isPublic,
  };

  if (category) {
    where.category = category;
  }

  if (eventType) {
    where.eventType = eventType;
  }

  if (username) {
    where.username = {
      contains: username,
      mode: 'insensitive',
    };
  }

  const [events, total] = await Promise.all([
    prisma.communityEvent.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.communityEvent.count({ where }),
  ]);

  return {
    events,
    total,
    hasMore: total > offset + limit,
  };
}

/**
 * Get event statistics for the dashboard
 */
export async function getEventStats(days: number = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [totalEvents, recentEvents, eventsByType] = await Promise.all([
    prisma.communityEvent.count({
      where: { isPublic: true },
    }),
    prisma.communityEvent.count({
      where: {
        isPublic: true,
        timestamp: { gte: since },
      },
    }),
    prisma.communityEvent.groupBy({
      by: ['eventType'],
      where: {
        isPublic: true,
        timestamp: { gte: since },
      },
      _count: {
        eventType: true,
      },
      orderBy: {
        _count: {
          eventType: 'desc',
        },
      },
      take: 10,
    }),
  ]);

  return {
    totalEvents,
    recentEvents,
    eventsByType: eventsByType.map(item => ({
      eventType: item.eventType,
      count: item._count.eventType,
      emoji: EVENT_EMOJIS[item.eventType] || EVENT_EMOJIS.default,
    })),
  };
}

/**
 * Helper function to determine category based on event type
 */
export function getCategoryForEventType(eventType: string): string {
  if (eventType.startsWith('user_') || eventType.includes('invitation')) {
    return EVENT_CATEGORIES.USER_MANAGEMENT;
  }
  if (eventType.includes('login') || eventType.includes('password') || eventType.includes('admin') || eventType.includes('moderator')) {
    return EVENT_CATEGORIES.AUTHENTICATION;
  }
  if (eventType.includes('message') || eventType.includes('email') || eventType.includes('signal')) {
    return EVENT_CATEGORIES.MESSAGING;
  }
  if (eventType.includes('room') || eventType.includes('matrix')) {
    return EVENT_CATEGORIES.MATRIX;
  }
  if (eventType.includes('permission')) {
    return EVENT_CATEGORIES.PERMISSIONS;
  }
  if (eventType.includes('system') || eventType.includes('sync') || eventType.includes('backup')) {
    return EVENT_CATEGORIES.SYSTEM;
  }
  return EVENT_CATEGORIES.SYSTEM; // Default fallback
} 