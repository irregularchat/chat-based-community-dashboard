

---

## 📋 Framework: P•E•S•I (Problem • Expected • Solution • Impact)

Use this structure **for any type of issue**:

| Section                | Use This To Describe...                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| **Problem**            | What’s missing, broken, unclear, or suboptimal? Be specific and include context. |
| **Expected**           | What should the behavior, capability, or design outcome be?                      |
| **Suggested Solution** | Your proposed approach — logic, file path, or UI pattern                         |
| **Impact**             | Why this matters — UX, security, performance, reliability, maintainability, etc. |

---

### ✨ Examples

#### 🐛 Bug Report

```markdown
**Problem:** Signup throws a 500 error when the email field is blank.

**Expected:** User should see a validation message on the frontend.

**Suggested Solution:** Add validation in `auth/forms.py`.

**Impact:** Prevents user frustration and protects backend resources.
```

#### ✨ Feature Request

```markdown
**Problem:** Admins cannot see message history when messaging Matrix users.

**Expected:** Show message history after selecting a user in 'Direct Message' tab.

**Suggested Solution:** Fetch from Matrix DM room using API, display in scrollable UI.

**Impact:** Enhances moderator workflow and auditability.
```

---

## 🔍 1. Search for Existing Issues (Prevent Duplicates)

Use `gh issue list`:

```bash
# See all open issues
gh issue list --state open

# Search for related keywords
gh issue list --search "signup"
gh issue list --search "matrix message"
```

Use this *before creating any new issue*. Duplicate issues slow triage and clutter boards.

---

## 🏷️ 2. Check or Create Labels

Use consistent tags for triage and visibility:

```bash
# View all existing labels
gh label list
```

### Create missing labels (if needed):

```bash
gh label create "bug" --description "Something isn't working" --color d73a4a
gh label create "feature" --description "New functionality" --color 0E8A16
gh label create "enhancement" --description "Improvement to existing behavior" --color a2eeef
gh label create "task" --description "Scoped internal task" --color c2e0c6
gh label create "admin-tools" --description "Issues related to admin dashboards and control panels" --color B60205
gh label create "matrix" --description "Matrix integration-related issues" --color 0052CC
gh label create "authentication" --description "Login, SSO, IdP, or token-related" --color 5319e7
```

---

## 🔎 3. Investigate the Codebase (to identify affected files/functions)

Use Cursor’s code navigation tools:

* **Right-click → Go to Definition** to locate functions or modules
* **Copy full file path** from file tree for precision

Or use CLI search:

```bash
# Find references to a method
grep -rnw . -e "send_matrix_message"
# → ./app/utils/matrix_actions.py:24:def send_matrix_message(room_id, message):
```

Include file and function paths in your issue for clarity:

```markdown
**File:** `app/utils/matrix_actions.py`  
**Function:** `send_matrix_message()`
```

---

## 📝 4. Create the Issue (with CLI)

Here's a reusable command for issue creation using the P•E•S•I format:

```bash
gh issue create \
  --title "[Feature] Show Matrix message history for selected user" \
  --body "**Problem:** Admins currently have no visibility into past Matrix messages with users via the Direct Message tab.

**Expected:** After selecting a Matrix user, previous bot-user messages should appear in a message log UI.

**Suggested Solution:** Resolve DM room using \`create_matrix_direct_chat()\` and fetch last 10–20 messages using Matrix API.

**Impact:** Reduces confusion, improves mod-to-user continuity, and enables transparent moderation." \
  --label "feature" \
  --label "matrix" \
  --label "admin-tools"
```

✅ You can paste this into Cursor's terminal or script multiple issues in `.sh` files.

---

## 🚦 5. Full Example Workflow

```bash
# Search for similar issue
gh issue list --search "matrix user"

# Check existing labels
gh label list

# Create label if missing
gh label create "moderation" --description "Issues related to moderator tools" --color 0052CC

# Create issue using template
gh issue create ...
```

---

## ✅ Summary

Use this guide to:

* Keep your issues **well-scoped, clear, and actionable**
* Help collaborators and AI tools understand context fast
* Maintain a clean, organized backlog

**Keep file paths, function names, and behavior descriptions specific.**

