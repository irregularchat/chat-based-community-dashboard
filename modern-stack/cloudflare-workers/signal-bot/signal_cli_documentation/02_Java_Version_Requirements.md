# Java Version Requirements

### Problem

**Initial Error**:
```
java.lang.UnsupportedClassVersionError: org/asamk/signal/Main has been compiled by a more recent version of the Java Runtime (class file version 65.0), this version of the Java Runtime only recognizes class file versions up to 61.0
```

**Root Cause**:
- signal-cli v0.13.22 is compiled with Java 21 (class file version 65.0)
- Container had Java 17 (supports up to class file version 61.0)

### Solution

**Multi-pronged Approach**:

1. **For signal-cli build stage** - Use Debian Trixie:
```dockerfile
FROM debian:trixie-slim AS signal-cli

RUN apt-get update && apt-get install -y \
    openjdk-21-jre-headless \
    wget
```

2. **For runtime stage** - Add Adoptium repository:
```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    curl wget apt-transport-https gnupg \
    && mkdir -p /etc/apt/keyrings \
    && wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public \
        | tee /etc/apt/keyrings/adoptium.asc \
    && echo "deb [signed-by=/etc/apt/keyrings/adoptium.asc] \
        https://packages.adoptium.net/artifactory/deb \
        $(awk -F= '/^VERSION_CODENAME/{print$2}' /etc/os-release) main" \
        | tee /etc/apt/sources.list.d/adoptium.list \
    && apt-get update \
    && apt-get install -y temurin-21-jre
```

### Lesson

✅ **Always verify Java version compatibility** before upgrading signal-cli
✅ **Use appropriate Debian version** - Trixie has Java 21, Bookworm does not
✅ **Consider Adoptium/Temurin** for controlled Java versions

**File**: `container/Dockerfile`
**Lines**: 24, 42-53

```