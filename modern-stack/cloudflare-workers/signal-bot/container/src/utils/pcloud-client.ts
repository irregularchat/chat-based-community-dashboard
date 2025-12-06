/**
 * pCloud API Client
 *
 * Provides file upload and folder management capabilities for pCloud.
 * Uses direct REST API calls for reliability.
 *
 * API Docs: https://docs.pcloud.com/
 *
 * Note: pCloud has two data centers:
 * - api.pcloud.com (United States)
 * - eapi.pcloud.com (Europe)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import FormData from 'form-data';
import { createReadStream } from 'fs';

// Types
export interface PCloudConfig {
  username?: string;
  password?: string;
  authToken?: string;
  apiHost?: string; // 'api.pcloud.com' or 'eapi.pcloud.com'
}

export interface PCloudAuthResponse {
  result: number;
  auth?: string;
  userid?: number;
  error?: string;
}

export interface PCloudFolderMetadata {
  folderid: number;
  name: string;
  path: string;
  isfolder: boolean;
  created?: string;
  modified?: string;
  contents?: PCloudFileMetadata[];
}

export interface PCloudFileMetadata {
  fileid?: number;
  folderid?: number;
  name: string;
  isfolder: boolean;
  size?: number;
  contenttype?: string;
  created?: string;
  modified?: string;
  path?: string;
  contents?: PCloudFileMetadata[];
}

export interface PCloudListFolderResponse {
  result: number;
  metadata?: PCloudFolderMetadata;
  error?: string;
}

export interface PCloudUploadResponse {
  result: number;
  fileids?: number[];
  metadata?: PCloudFileMetadata[];
  error?: string;
}

export interface PCloudCreateFolderResponse {
  result: number;
  metadata?: PCloudFolderMetadata;
  error?: string;
}

/**
 * pCloud API Client
 */
export class PCloudClient {
  private authToken: string | null = null;
  private apiHost: string;
  private userid: number | null = null;

  constructor(private config: PCloudConfig) {
    // Default to US datacenter (api.pcloud.com), EU accounts must use eapi.pcloud.com
    this.apiHost = config.apiHost || 'api.pcloud.com';
    this.authToken = config.authToken || null;
  }

  /**
   * Get the base API URL
   */
  private getApiUrl(endpoint: string): string {
    return `https://${this.apiHost}/${endpoint}`;
  }

  /**
   * Authenticate with pCloud using username/password
   * Returns an auth token that can be reused
   */
  async login(): Promise<{ success: boolean; authToken?: string; userid?: number; error?: string }> {
    if (this.authToken) {
      console.log('Already have auth token, verifying...');
      const verified = await this.verifyToken();
      if (verified) {
        return { success: true, authToken: this.authToken };
      }
      console.log('Token invalid, re-authenticating...');
    }

    if (!this.config.username || !this.config.password) {
      return { success: false, error: 'Username and password required for login' };
    }

    try {
      const params = new URLSearchParams({
        username: this.config.username,
        password: this.config.password,
        getauth: '1',
        logout: '1', // Logout other sessions
        authexpire: '31536000', // 1 year expiry
      });

      const response = await fetch(this.getApiUrl('userinfo'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const data = await response.json() as PCloudAuthResponse;

      if (data.result === 0 && data.auth) {
        this.authToken = data.auth;
        this.userid = data.userid || null;
        console.log(`pCloud login successful. User ID: ${this.userid}`);
        return { success: true, authToken: this.authToken, userid: this.userid || undefined };
      } else {
        return { success: false, error: data.error || `Login failed with code ${data.result}` };
      }
    } catch (error) {
      return { success: false, error: `Login error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  /**
   * Verify if current token is valid
   */
  async verifyToken(): Promise<boolean> {
    if (!this.authToken) return false;

    try {
      const params = new URLSearchParams({
        auth: this.authToken,
      });

      const response = await fetch(this.getApiUrl('userinfo') + '?' + params.toString());
      const data = await response.json() as any;

      return data.result === 0;
    } catch {
      return false;
    }
  }

  /**
   * List contents of a folder
   */
  async listFolder(folderIdOrPath: number | string, recursive = false): Promise<{
    success: boolean;
    folder?: PCloudFolderMetadata;
    error?: string;
  }> {
    if (!this.authToken) {
      const loginResult = await this.login();
      if (!loginResult.success) {
        return { success: false, error: loginResult.error };
      }
    }

    try {
      const params = new URLSearchParams({
        auth: this.authToken!,
      });

      if (typeof folderIdOrPath === 'number') {
        params.append('folderid', folderIdOrPath.toString());
      } else {
        params.append('path', folderIdOrPath);
      }

      if (recursive) {
        params.append('recursive', '1');
      }

      const response = await fetch(this.getApiUrl('listfolder') + '?' + params.toString());
      const data = await response.json() as PCloudListFolderResponse;

      if (data.result === 0 && data.metadata) {
        return { success: true, folder: data.metadata };
      } else {
        return { success: false, error: data.error || `List folder failed with code ${data.result}` };
      }
    } catch (error) {
      return { success: false, error: `List folder error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  /**
   * Create a folder
   */
  async createFolder(name: string, parentFolderIdOrPath: number | string): Promise<{
    success: boolean;
    folder?: PCloudFolderMetadata;
    error?: string;
  }> {
    if (!this.authToken) {
      const loginResult = await this.login();
      if (!loginResult.success) {
        return { success: false, error: loginResult.error };
      }
    }

    try {
      const params = new URLSearchParams({
        auth: this.authToken!,
        name: name,
      });

      if (typeof parentFolderIdOrPath === 'number') {
        params.append('folderid', parentFolderIdOrPath.toString());
      } else {
        params.append('path', parentFolderIdOrPath);
      }

      const response = await fetch(this.getApiUrl('createfolder') + '?' + params.toString());
      const data = await response.json() as PCloudCreateFolderResponse;

      if (data.result === 0 && data.metadata) {
        return { success: true, folder: data.metadata };
      } else if (data.result === 2004) {
        // Folder already exists - try to get it
        const listResult = await this.listFolder(parentFolderIdOrPath);
        if (listResult.success && listResult.folder?.contents) {
          const existing = listResult.folder.contents.find(
            f => f.isfolder && f.name.toLowerCase() === name.toLowerCase()
          );
          if (existing) {
            return {
              success: true,
              folder: {
                folderid: existing.folderid!,
                name: existing.name,
                path: existing.path || '',
                isfolder: true,
              },
            };
          }
        }
        return { success: false, error: 'Folder already exists but could not be retrieved' };
      } else {
        return { success: false, error: data.error || `Create folder failed with code ${data.result}` };
      }
    } catch (error) {
      return { success: false, error: `Create folder error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  /**
   * Upload a file from local path
   */
  async uploadFile(
    localFilePath: string,
    targetFolderIdOrPath: number | string,
    options?: {
      filename?: string;
      renameIfExists?: boolean;
    }
  ): Promise<{
    success: boolean;
    file?: PCloudFileMetadata;
    error?: string;
  }> {
    if (!this.authToken) {
      const loginResult = await this.login();
      if (!loginResult.success) {
        return { success: false, error: loginResult.error };
      }
    }

    try {
      // Check if file exists
      try {
        await fs.access(localFilePath);
      } catch {
        return { success: false, error: `File not found: ${localFilePath}` };
      }

      const filename = options?.filename || path.basename(localFilePath);
      const fileStream = createReadStream(localFilePath);

      // Build URL with params
      const params = new URLSearchParams({
        auth: this.authToken!,
        filename: filename,
      });

      if (typeof targetFolderIdOrPath === 'number') {
        params.append('folderid', targetFolderIdOrPath.toString());
      } else {
        params.append('path', targetFolderIdOrPath);
      }

      if (options?.renameIfExists) {
        params.append('renameifexists', '1');
      }

      // Create form data
      const form = new FormData();
      form.append('file', fileStream, filename);

      const response = await fetch(this.getApiUrl('uploadfile') + '?' + params.toString(), {
        method: 'POST',
        body: form as any,
        headers: form.getHeaders(),
      });

      const data = await response.json() as PCloudUploadResponse;

      if (data.result === 0 && data.metadata && data.metadata.length > 0) {
        console.log(`File uploaded successfully: ${filename}`);
        return { success: true, file: data.metadata[0] };
      } else {
        return { success: false, error: data.error || `Upload failed with code ${data.result}` };
      }
    } catch (error) {
      return { success: false, error: `Upload error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  /**
   * Upload a file from Buffer
   */
  async uploadBuffer(
    buffer: Buffer,
    filename: string,
    targetFolderIdOrPath: number | string,
    options?: {
      renameIfExists?: boolean;
    }
  ): Promise<{
    success: boolean;
    file?: PCloudFileMetadata;
    error?: string;
  }> {
    if (!this.authToken) {
      const loginResult = await this.login();
      if (!loginResult.success) {
        return { success: false, error: loginResult.error };
      }
    }

    try {
      // Build URL with params
      const params = new URLSearchParams({
        auth: this.authToken!,
        filename: filename,
      });

      if (typeof targetFolderIdOrPath === 'number') {
        params.append('folderid', targetFolderIdOrPath.toString());
      } else {
        params.append('path', targetFolderIdOrPath);
      }

      if (options?.renameIfExists) {
        params.append('renameifexists', '1');
      }

      // Create form data
      const form = new FormData();
      form.append('file', buffer, { filename });

      const response = await fetch(this.getApiUrl('uploadfile') + '?' + params.toString(), {
        method: 'POST',
        body: form as any,
        headers: form.getHeaders(),
      });

      const data = await response.json() as PCloudUploadResponse;

      if (data.result === 0 && data.metadata && data.metadata.length > 0) {
        console.log(`Buffer uploaded successfully as: ${filename}`);
        return { success: true, file: data.metadata[0] };
      } else {
        return { success: false, error: data.error || `Upload failed with code ${data.result}` };
      }
    } catch (error) {
      return { success: false, error: `Upload error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  /**
   * Get a public link for a file
   */
  async getPublicLink(fileId: number): Promise<{
    success: boolean;
    link?: string;
    error?: string;
  }> {
    if (!this.authToken) {
      const loginResult = await this.login();
      if (!loginResult.success) {
        return { success: false, error: loginResult.error };
      }
    }

    try {
      const params = new URLSearchParams({
        auth: this.authToken!,
        fileid: fileId.toString(),
      });

      const response = await fetch(this.getApiUrl('getfilepublink') + '?' + params.toString());
      const data = await response.json() as any;

      if (data.result === 0 && data.link) {
        return { success: true, link: data.link };
      } else {
        return { success: false, error: data.error || `Get link failed with code ${data.result}` };
      }
    } catch (error) {
      return { success: false, error: `Get link error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(fileId: number): Promise<{ success: boolean; error?: string }> {
    if (!this.authToken) {
      const loginResult = await this.login();
      if (!loginResult.success) {
        return { success: false, error: loginResult.error };
      }
    }

    try {
      const params = new URLSearchParams({
        auth: this.authToken!,
        fileid: fileId.toString(),
      });

      const response = await fetch(this.getApiUrl('deletefile') + '?' + params.toString());
      const data = await response.json() as any;

      if (data.result === 0) {
        return { success: true };
      } else {
        return { success: false, error: data.error || `Delete failed with code ${data.result}` };
      }
    } catch (error) {
      return { success: false, error: `Delete error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  /**
   * Get auth token for storage/reuse
   */
  getAuthToken(): string | null {
    return this.authToken;
  }

  /**
   * Set auth token (for reusing saved tokens)
   */
  setAuthToken(token: string): void {
    this.authToken = token;
  }

  /**
   * Get file info by path (to get fileid)
   */
  async getFileByPath(filePath: string): Promise<{
    success: boolean;
    file?: PCloudFileMetadata;
    error?: string;
  }> {
    if (!this.authToken) {
      const loginResult = await this.login();
      if (!loginResult.success) {
        return { success: false, error: loginResult.error };
      }
    }

    try {
      const params = new URLSearchParams({
        auth: this.authToken!,
        path: filePath,
      });

      const response = await fetch(this.getApiUrl('stat') + '?' + params.toString());
      const data = await response.json() as any;

      if (data.result === 0 && data.metadata) {
        return { success: true, file: data.metadata };
      } else {
        return { success: false, error: data.error || `Get file failed with code ${data.result}` };
      }
    } catch (error) {
      return { success: false, error: `Get file error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  /**
   * Get direct download link for a file by its fileid
   */
  async getFileLink(fileId: number): Promise<{
    success: boolean;
    link?: string;
    error?: string;
  }> {
    if (!this.authToken) {
      const loginResult = await this.login();
      if (!loginResult.success) {
        return { success: false, error: loginResult.error };
      }
    }

    try {
      const params = new URLSearchParams({
        auth: this.authToken!,
        fileid: fileId.toString(),
      });

      const response = await fetch(this.getApiUrl('getfilelink') + '?' + params.toString());
      const data = await response.json() as any;

      if (data.result === 0 && data.hosts && data.hosts.length > 0 && data.path) {
        // Construct the download URL
        const downloadUrl = `https://${data.hosts[0]}${data.path}`;
        return { success: true, link: downloadUrl };
      } else {
        return { success: false, error: data.error || `Get link failed with code ${data.result}` };
      }
    } catch (error) {
      return { success: false, error: `Get link error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  /**
   * Get direct download link by file path
   */
  async getFileLinkByPath(filePath: string): Promise<{
    success: boolean;
    link?: string;
    error?: string;
  }> {
    // First get the file info to get the fileid
    const fileResult = await this.getFileByPath(filePath);
    if (!fileResult.success || !fileResult.file?.fileid) {
      return { success: false, error: fileResult.error || 'Could not get file info' };
    }

    // Then get the download link
    return this.getFileLink(fileResult.file.fileid);
  }
}

/**
 * Create and initialize a pCloud client from environment variables
 */
export function createPCloudClient(): PCloudClient {
  const config: PCloudConfig = {
    username: process.env.PCLOUD_USERNAME,
    password: process.env.PCLOUD_PASSWORD,
    authToken: process.env.PCLOUD_AUTH_TOKEN,
    apiHost: process.env.PCLOUD_API_HOST || 'api.pcloud.com', // Default to US
  };

  return new PCloudClient(config);
}

// Export singleton for shared use
let _pcloudClient: PCloudClient | null = null;

export function getPCloudClient(): PCloudClient {
  if (!_pcloudClient) {
    _pcloudClient = createPCloudClient();
  }
  return _pcloudClient;
}
