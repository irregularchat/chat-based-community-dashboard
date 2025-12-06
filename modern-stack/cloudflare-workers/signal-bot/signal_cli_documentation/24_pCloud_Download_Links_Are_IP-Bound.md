# pCloud Download Links Are IP-Bound (2025-12-04)

### Problem

**Symptom**: pCloud file search results returned links that led to "dead pages" or "HTTP 410 Gone" errors.

**Initial Investigation**:
```bash
# Fresh API call from server - returns 200 OK
curl -sI "https://def1.pcloud.com/[fresh-path]/file.pdf"
# HTTP/1.1 200 OK

# Same URL from user's browser - returns 410 Gone
# HTTP/1.1 410 Gone
```

**Root Cause**: pCloud's `getpublinkdownload` API generates **temporary IP-bound download URLs** that:
1. Are valid only for the IP that generated them
2. Expire after ~4-6 hours
3. Return `HTTP 410 Gone` when accessed from a different IP

Since the Signal bot server generates the URL, but users click from their own IPs, the links never work.

### Solution

**Instead of generating direct download URLs, use pCloud web viewer URLs**:

```typescript
// WRONG - Temporary IP-bound URL (doesn't work for users!)
export async function getDirectDownloadLink(relativePath: string) {
  const response = await fetch(`https://api.pcloud.com/getpublinkdownload?code=${code}&fileid=${fileid}`);
  const data = await response.json();
  return `https://${data.hosts[0]}${data.path}`;  // IP-bound!
}

// CORRECT - Web viewer URL (works for everyone!)
export async function getDirectDownloadLink(relativePath: string) {
  const entry = pcloudIndex.files.get(relativePath);
  // Format: https://u.pcloud.link/publink/show?code=XXX#folder=FOLDER_ID&file=FILE_ID
  return `${PCLOUD_PUBLIC_URL}#folder=${entry.parentfolderid}&file=${entry.fileid}`;
}
```

**How the web viewer URL works**:
1. User clicks the link → pCloud web interface loads
2. Web app interprets `#folder=X&file=Y` fragment
3. Navigates directly to the file's parent folder
4. User can view/download from there (generates their own IP-bound download)

### Implementation Details

**Updated pCloud file index** to track parent folder IDs:
```typescript
interface PCloudFileEntry {
  fileid: number;
  parentfolderid: number;  // NEW: Required for web viewer URL
  name: string;
  path: string;
  size: number;
}
```

**Recursive indexing** captures parent folder IDs:
```typescript
function indexPCloudContents(
  contents: any[],
  currentPath: string,
  parentFolderId: number,  // Track parent
  files: Map<string, PCloudFileEntry>
): void {
  for (const item of contents) {
    if (item.isfolder) {
      indexPCloudContents(item.contents, itemPath, item.folderid || parentFolderId, files);
    } else if (item.fileid) {
      files.set(itemPath.toLowerCase(), {
        fileid: item.fileid,
        parentfolderid: item.parentfolderid || parentFolderId,
        name: item.name,
        path: itemPath,
        size: item.size || 0,
      });
    }
  }
}
```

### pCloud API Reference

**Two data centers** (must match user's account location):
- `api.pcloud.com` - United States
- `eapi.pcloud.com` - Europe

**Useful endpoints**:
- `showpublink?code=XXX` - Get folder structure with fileids (recursive)
- `getpublinkdownload?code=XXX&fileid=Y` - Get temporary download URL (IP-bound!)
- `getfilepublink?fileid=Y&auth=TOKEN` - Create new public link (requires auth)

### Lesson

✅ **pCloud download URLs from `getpublinkdownload` are IP-bound** - don't use for sharing
✅ **Use web viewer URLs** with `#folder=X&file=Y` fragment for shareable links
✅ **Store `parentfolderid`** in file index for web viewer URL construction
✅ **Match API host to account location** (US: api.pcloud.com, EU: eapi.pcloud.com)

**Sources**:
- [pCloud SDK PHP GitHub Issue #15](https://github.com/pCloud/pcloud-sdk-php/issues/15)
- [Stack Overflow: Download files with pCloud API](https://stackoverflow.com/questions/73759126/download-files-with-the-pcloud-api)
- [pCloud API Documentation](https://docs.pcloud.com/methods/public_links/)

**Files**: `container/src/utils/file-search.ts`
