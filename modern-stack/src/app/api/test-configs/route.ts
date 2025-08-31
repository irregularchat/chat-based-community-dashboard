import { NextResponse } from 'next/server';
import { authentikService } from '@/lib/authentik';
import { emailService } from '@/lib/email';

export async function GET() {
  const configurations = {
    matrix: {
      configured: !!(
        process.env.MATRIX_HOMESERVER &&
        process.env.MATRIX_ACCESS_TOKEN &&
        process.env.MATRIX_USER_ID
      ),
      homeserver: process.env.MATRIX_HOMESERVER,
      userId: process.env.MATRIX_USER_ID,
    },
    authentik: {
      configured: authentikService.isConfigured(),
      config: authentikService.getConfig(),
    },
    email: {
      configured: emailService.isConfigured(),
      config: emailService.getConfig(),
    },
    discourse: {
      configured: !!(
        process.env.DISCOURSE_URL &&
        process.env.DISCOURSE_API_KEY &&
        process.env.DISCOURSE_API_USERNAME
      ),
      url: process.env.DISCOURSE_URL,
      apiUsername: process.env.DISCOURSE_API_USERNAME,
    },
    ai: {
      configured: !!(
        process.env.OPENAI_API_KEY ||
        process.env.CLAUDE_API_KEY ||
        process.env.LOCAL_AI_ENDPOINT
      ),
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasClaude: !!process.env.CLAUDE_API_KEY,
      hasLocal: !!process.env.LOCAL_AI_ENDPOINT,
    },
  };

  return NextResponse.json({
    status: 'success',
    configurations,
    summary: {
      matrix: configurations.matrix.configured ? '✅ Configured' : '❌ Not configured',
      authentik: configurations.authentik.configured ? '✅ Configured' : '❌ Not configured',
      email: configurations.email.configured ? '✅ Configured' : '❌ Not configured',
      discourse: configurations.discourse.configured ? '✅ Configured' : '❌ Not configured',
      ai: configurations.ai.configured ? '✅ Configured' : '❌ Not configured',
    },
  });
}