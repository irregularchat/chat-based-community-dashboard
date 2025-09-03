#!/usr/bin/env python3
import json
import subprocess

# Get groups list
result = subprocess.run(
    'echo \'{"jsonrpc":"2.0","method":"listGroups","params":{"account":"+19108471202","get-members":true},"id":999}\' | nc -U /tmp/signal-cli-socket',
    shell=True,
    capture_output=True,
    text=True
)

data = json.loads(result.stdout)
joshua_uuid = "01383f13-1479-4058-b51b-d39244b679f4"

# Find Space group
space_group = None
for group in data['result']:
    if group.get('name') == 'IRREGULARCHAT: Space':
        space_group = group
        break

if not space_group:
    print("❌ Space group not found")
    exit(1)

print(f"📊 Space Group Analysis:")
print(f"   Name: {space_group.get('name')}")
print(f"   ID: {space_group.get('id')}")
print(f"   Permission to add: {space_group.get('permissionAddMember')}")
print(f"   Total members: {len(space_group.get('members', []))}")

# Check if Joshua is in members
is_member = any(m.get('uuid') == joshua_uuid for m in space_group.get('members', []))
print(f"\n✅ Joshua is a member: {is_member}")

# Check pending
pending = space_group.get('pendingMembers', [])
is_pending = any(m.get('uuid') == joshua_uuid for m in pending) if pending else False
print(f"⏳ Joshua is pending: {is_pending}")

# Check banned
banned = space_group.get('banned', [])
is_banned = any(m.get('uuid') == joshua_uuid for m in banned) if banned else False
print(f"🚫 Joshua is banned: {is_banned}")

# Check requesting
requesting = space_group.get('requestingMembers', [])
is_requesting = any(m.get('uuid') == joshua_uuid for m in requesting) if requesting else False
print(f"📨 Joshua is requesting: {is_requesting}")

# List all other groups Joshua is in
print(f"\n📱 Other groups with Joshua:")
for group in data['result']:
    if group.get('name') != 'IRREGULARCHAT: Space':
        members = group.get('members', [])
        if any(m.get('uuid') == joshua_uuid for m in members):
            print(f"   - {group.get('name')}")