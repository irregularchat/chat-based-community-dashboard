# Auto-Archive Documents After Virus Scan (2025-12-04)

### Problem
Users wanted documents (PDFs, PPTX, STL files, etc.) to be automatically archived to pCloud after the automatic virus scan, without needing to manually use `!archive`.

### Solution
Extended the `autoScanAttachments()` function in `signal-bot-v2.ts` to:
1. Track clean files eligible for auto-archive
2. After virus scan, automatically organize and upload safe file types
3. Return pCloud viewer links in the scan results message

### Implementation

**Safe file types for auto-archive** (defined in `AUTO_ARCHIVE_EXTENSIONS`):
- **Documents**: `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.odt`, `.ods`, `.odp`, `.rtf`, `.csv`
- **Text/code**: `.md`, `.json`, `.yaml`, `.yml`, `.txt`
- **Fabrication/3D**: `.stl`, `.gcode`, `.step`, `.stp`, `.iges`, `.igs`, `.scad`, `.obj`, `.3mf`, `.amf`, `.dxf`, `.dwg`

**Flow**:
1. Auto-scan runs ClamAV on attachment
2. If clean AND extension is in `AUTO_ARCHIVE_EXTENSIONS`:
   - Get group name from database for categorization
   - Call `organizeFile()` from file-organizer.ts
   - Upload to pCloud via rclone
   - Get public link via `rclone link`
3. Send combined message with scan results + archive links

### Code Changes

```typescript
// signal-bot-v2.ts - New import
import { organizeFile, getDirectoryForGroup, FileOrganizeResult } from '../utils/file-organizer.js';

// Track clean files during scanning
interface CleanFileInfo {
  filename: string;
  filePath: string;
  ext: string;
  fileSizeKB: number;
}
const cleanFiles: CleanFileInfo[] = [];

// When virus scan passes
if (stdout.includes('OK')) {
  results.push(`✅ ${filename} (${fileSizeKB} KB) - Clean`);
  if (AUTO_ARCHIVE_EXTENSIONS.has(ext)) {
    cleanFiles.push({ filename, filePath: targetFile.path, ext, fileSizeKB });
  }
}

// After all scans, archive clean files
for (const cleanFile of cleanFiles) {
  const result = await organizeFile(cleanFile.filePath, { groupName, scanVirus: false });
  // Upload via rclone and get link...
}
```

### Message Format

When a user uploads a document, they now see:

```
🛡️ Auto-Scan Results

✅ report.pdf (245 KB) - Clean

✓ Files scanned with ClamAV

📂 Auto-Archived to pCloud:

📁 report.pdf → Research/Documents
   ☁️ https://u.pcloud.link/publink/show?...
```

### Group-to-Directory Mapping

Files are automatically categorized based on Signal group name using `file-organizer.ts`:
- `ai/ml`, `machine learning` → `AI-ML/`
- `drone`, `uav`, `fpv` → `UnmannedSystems/`
- `cyber`, `infosec` → `Cybersecurity/`
- `fabrication`, `3d print` → `Fabrication/`
- Unknown groups → `UNSORTED/`

### Lesson

✅ **Auto-archive eliminates manual `!archive` step** for safe file types
✅ **Virus scan happens first** - infected files are NOT archived
✅ **Group-based categorization** routes files to appropriate directories
✅ **pCloud links returned immediately** for easy sharing

**Files**:
- `container/src/bot/signal-bot-v2.ts` - Auto-scan with auto-archive logic
- `container/src/utils/file-organizer.ts` - Group-to-directory mapping
