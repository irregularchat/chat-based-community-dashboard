import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST() {
  try {
    console.log('🔄 Initializing database with environment variables...');

    // Environment variable mappings
    const envMappings = {
      // NextAuth
      'nextauth_url': process.env.NEXTAUTH_URL,
      
      // Authentik/OIDC Configuration
      'authentik_client_id': process.env.OIDC_CLIENT_ID,
      'authentik_client_secret': process.env.OIDC_CLIENT_SECRET,
      'authentik_issuer': process.env.AUTHENTIK_ISSUER,
      'authentik_base_url': process.env.AUTHENTIK_BASE_URL || process.env.AUTHENTIK_API_URL,
      'authentik_api_token': process.env.AUTHENTIK_API_TOKEN,
      'oidc_authorization_endpoint': process.env.OIDC_AUTHORIZATION_ENDPOINT,
      'oidc_token_endpoint': process.env.OIDC_TOKEN_ENDPOINT,
      'oidc_userinfo_endpoint': process.env.OIDC_USERINFO_ENDPOINT,
      'oidc_end_session_endpoint': process.env.OIDC_END_SESSION_ENDPOINT,
      'oidc_redirect_uri': process.env.OIDC_REDIRECT_URI,
      'oidc_scopes': process.env.OIDC_SCOPES,
      
      // Authentik specific
      'main_group_id': process.env.MAIN_GROUP_ID,
      'flow_id': process.env.FLOW_ID,
      'invite_flow_id': process.env.INVITE_FLOW_ID,
      'invite_label': process.env.INVITE_LABEL,
      
      // Matrix Configuration
      'matrix_active': process.env.MATRIX_ACTIVE,
      'matrix_url': process.env.MATRIX_URL || process.env.MATRIX_HOMESERVER_URL,
      'matrix_access_token': process.env.MATRIX_ACCESS_TOKEN,
      'matrix_bot_username': process.env.MATRIX_BOT_USERNAME,
      'matrix_bot_display_name': process.env.MATRIX_BOT_DISPLAY_NAME,
      'matrix_default_room_id': process.env.MATRIX_DEFAULT_ROOM_ID,
      'matrix_welcome_room_id': process.env.MATRIX_WELCOME_ROOM_ID,
      
      // SMTP Configuration
      'smtp_active': process.env.SMTP_ACTIVE,
      'smtp_server': process.env.SMTP_SERVER,
      'smtp_port': process.env.SMTP_PORT,
      'smtp_username': process.env.SMTP_USERNAME,
      'smtp_password': process.env.SMTP_PASSWORD,
      'smtp_from_email': process.env.SMTP_FROM_EMAIL,
      
      // General Settings
      'page_title': process.env.PAGE_TITLE,
      'favicon_url': process.env.FAVICON_URL,
      'base_domain': process.env.BASE_DOMAIN,
      'theme': process.env.THEME,
    };

    const updates = [];
    
    for (const [key, value] of Object.entries(envMappings)) {
      if (value) {
        updates.push(
          prisma.dashboardSettings.upsert({
            where: { key },
            update: { value: value as string },
            create: { key, value: value as string },
          })
        );
      }
    }

    if (updates.length > 0) {
      await prisma.$transaction(updates);
      
      console.log(`✅ Initialized ${updates.length} settings from environment variables`);
      
      return NextResponse.json({ 
        success: true, 
        message: `Successfully initialized ${updates.length} settings from environment variables`,
        initialized: updates.length 
      });
    } else {
      return NextResponse.json({ 
        success: true, 
        message: 'No environment variables found to initialize',
        initialized: 0 
      });
    }
  } catch (error) {
    console.error('Database initialization failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : 'No stack trace'
    }, { status: 500 });
  }
}