/**
 * R2 Storage Handler
 *
 * Provides R2 storage operations for the Signal bot container.
 * The container doesn't have direct R2 bindings, so it calls these endpoints.
 */

export interface Env {
  SIGNAL_DATA: R2Bucket;
}

export interface UploadRequest {
  key: string;
  content: string;
  contentType?: string;
  encoding?: 'base64' | 'utf8';
}

export interface UploadResult {
  key: string;
  url: string;
  size: number;
  etag?: string;
}

/**
 * Upload file to R2
 */
export async function handleUpload(request: Request, env: Env): Promise<Response> {
  try {
    // Parse request body
    const body: UploadRequest = await request.json();

    if (!body.key || !body.content) {
      return new Response(JSON.stringify({
        error: 'key and content required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Decode content based on encoding
    let data: Uint8Array;
    if (body.encoding === 'base64') {
      // Decode base64
      const binaryString = atob(body.content);
      data = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        data[i] = binaryString.charCodeAt(i);
      }
    } else {
      // UTF-8 string
      data = new TextEncoder().encode(body.content);
    }

    // Upload to R2
    const startTime = Date.now();
    const object = await env.SIGNAL_DATA.put(body.key, data, {
      httpMetadata: {
        contentType: body.contentType || 'application/octet-stream',
      },
    });
    const duration = Date.now() - startTime;

    if (!object) {
      throw new Error('Upload failed');
    }

    // Return result
    const result: UploadResult = {
      key: body.key,
      url: `/api/r2/download/${encodeURIComponent(body.key)}`,
      size: data.length,
      etag: object.etag,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Response-Time': `${duration}ms`,
      }
    });

  } catch (error) {
    console.error('R2 upload error:', error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Upload failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Download file from R2
 */
export async function handleDownload(request: Request, env: Env, key: string): Promise<Response> {
  try {
    // Get object from R2
    const object = await env.SIGNAL_DATA.get(key);

    if (!object) {
      return new Response(JSON.stringify({
        error: 'File not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Return file
    return new Response(object.body, {
      status: 200,
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Length': String(object.size),
        'ETag': object.etag,
        'Last-Modified': object.uploaded.toUTCString(),
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      }
    });

  } catch (error) {
    console.error('R2 download error:', error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Download failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Delete file from R2
 */
export async function handleDelete(request: Request, env: Env, key: string): Promise<Response> {
  try {
    // Delete from R2
    await env.SIGNAL_DATA.delete(key);

    return new Response(JSON.stringify({
      success: true,
      key,
      message: 'File deleted'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('R2 delete error:', error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Delete failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * List files in R2
 */
export async function handleList(request: Request, env: Env): Promise<Response> {
  try {
    // Get URL params
    const url = new URL(request.url);
    const prefix = url.searchParams.get('prefix') || undefined;
    const limit = parseInt(url.searchParams.get('limit') || '1000');
    const cursor = url.searchParams.get('cursor') || undefined;

    // List objects
    const listed = await env.SIGNAL_DATA.list({
      prefix,
      limit,
      cursor,
    });

    // Return list
    return new Response(JSON.stringify({
      success: true,
      files: listed.objects.map(obj => ({
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded.toISOString(),
        etag: obj.etag,
      })),
      truncated: listed.truncated,
      cursor: (listed as any).cursor,
      total: listed.objects.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('R2 list error:', error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'List failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Get file metadata from R2
 */
export async function handleHead(request: Request, env: Env, key: string): Promise<Response> {
  try {
    // Head object from R2
    const object = await env.SIGNAL_DATA.head(key);

    if (!object) {
      return new Response(JSON.stringify({
        error: 'File not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Return metadata
    return new Response(JSON.stringify({
      success: true,
      key: object.key,
      size: object.size,
      uploaded: object.uploaded.toISOString(),
      etag: object.etag,
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('R2 head error:', error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Head failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Get R2 storage stats
 */
export async function handleStats(request: Request, env: Env): Promise<Response> {
  try {
    // List all objects to calculate stats
    let totalSize = 0;
    let totalFiles = 0;
    let cursor: string | undefined = undefined;

    do {
      const listed = await env.SIGNAL_DATA.list({
        limit: 1000,
        cursor,
      });

      for (const obj of listed.objects) {
        totalSize += obj.size;
        totalFiles++;
      }

      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    return new Response(JSON.stringify({
      success: true,
      totalFiles,
      totalSize,
      totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('R2 stats error:', error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Stats failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
