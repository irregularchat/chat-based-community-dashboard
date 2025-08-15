import { NextRequest, NextResponse } from 'next/server';
import { authentikService } from '@/lib/authentik';
import { prisma } from '@/lib/prisma';

export async function POST(_request: NextRequest) {
  try {
    console.log('Creating test invite: unmanned_pause for 4 days...');
    
    // Calculate expiry date (4 days from now)
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 4);
    
    console.log(`Invite will expire on: ${expiryDate.toISOString()}`);
    
    // Create invite via Authentik
    const result = await authentikService.createInvite({
      label: 'unmanned_pause',
      expires: expiryDate,
      groups: [], // No specific groups
      createdBy: 'test-admin',
    });
    
    if (!result.success) {
      console.error('Authentik invite creation failed:', result.error);
      return NextResponse.json({ 
        success: false, 
        error: result.error || 'Failed to create invite via Authentik' 
      }, { status: 500 });
    }
    
    console.log('Authentik invite created successfully:', result);
    
    // Store invite in local database for tracking
    const invite = await prisma.invite.create({
      data: {
        token: result.invite_id!,
        label: 'unmanned_pause',
        expiresAt: expiryDate,
        createdBy: 'test-admin',
        groups: null, // No groups specified
      },
    });
    
    console.log('Invite stored in database with ID:', invite.id);
    
    // Log admin event
    await prisma.adminEvent.create({
      data: {
        eventType: 'test_invite_created',
        username: 'test-admin',
        details: `Created test invite "unmanned_pause" (expires: ${expiryDate.toISOString()}, not single use)`,
      },
    });
    
    console.log('Test invite creation completed successfully!');
    
    return NextResponse.json({
      success: true,
      inviteLink: result.invite_link!,
      inviteId: result.invite_id!,
      label: 'unmanned_pause',
      expiryDate: expiryDate.toISOString(),
      validDays: 4,
      singleUse: false,
      databaseId: invite.id,
      message: `Test invite created successfully! Label: unmanned_pause, Valid for 4 days, Not single use.`
    });
    
  } catch (error) {
    console.error('Test invite creation failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : 'No stack trace'
    }, { status: 500 });
  }
}

export async function GET(_request: NextRequest) {
  try {
    // Get recent test invites
    const invites = await prisma.invite.findMany({
      where: {
        label: 'unmanned_pause',
        expiresAt: {
          gt: new Date() // Only non-expired invites
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    
    return NextResponse.json({
      success: true,
      activeTestInvites: invites,
      count: invites.length
    });
    
  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}