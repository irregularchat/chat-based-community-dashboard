# 🚀 Feature Request: Automated User Invite & Self-Service Onboarding

## Context
"Signal" rooms or accounts can typically be treated as matrix rooms or accounts as they are bridged. 
Most of these functions currently exists in helpers/api/matrix and are called in forms.py some adjustments would need to be made to lock down functions for non admin users. 



## Problem

Currently, onboarding new users is a heavily manual and resource-intensive process:

__See Current Process__ Forum Post: https://forum.irregularchat.com/t/building-communities/86/3?u=sac

* Admins manually track invite requests with a ratio of approximately 250 users per active moderator.
* Users must manually join an entry room; moderators must then manually prompt introductions.
* Confusion arises because users often request access using invite links and reference the person to vouch for them by names instead of their usernames, making it challenging to verify who initiated the invite.
* Admins spend considerable time validating and tracking invite requests.

## Expected Behavior

* An existing user logged into the Identity Provider (IdP) can send direct invites via email or Signal through a user-facing dashboard.
* If the existing user’s Matrix username is connected, they should automatically be able to add the invited user into available rooms.
* Invited users receive a unique, single-use invite link that leads to a publicly accessible registration page.
* Registration validates the invite link and restricts account creation to the invited email or Signal number.
* Registration automatically triggers user account creation and auto-addition to relevant rooms.
* Invites are transparently logged as `UserEvent` on the existing event timeline.
* Admin approval can be enforced for selected users based on account age or other criteria.
* The public invite link can be removed from community Signal rooms to reduce spam and confusion.

## Suggested Solution

### 1. User-Facing Invite Page

* Create a dashboard page allowing users to invite others via email or Signal.
* Utilize existing SMTP/Signal bridge functionalities for sending invites.
* Store invites in the existing database using a dedicated `Invite` model.

### 2. Event Logging

* Implement `UserEvent` alongside the existing `AdminEvent` to log user-initiated invites.
* Provide a clear, audit-friendly view of invite actions in the community timeline.

### 3. Public Registration Page

* Develop a publicly accessible form validating invite tokens and associated emails/Signal contacts.
* Restrict registration to one user per invite token.
* Upon successful validation, utilize existing user creation logic (`forms.py`, `auth/api.py`).

### 4. Automated Room Assignment

* After registration, automatically add users to appropriate Matrix or Signal rooms.
* Leverage existing methods within `matrix.py` and Signal bridge integration (`matrix_actions.py`).

### 5. Optional Admin Approval

* Integrate optional admin approval workflows based on account age or flagged criteria.
* Utilize existing approval mechanisms from admin tools.

### 6. Decommission Public Invite Links

* Once implemented, remove public invite links from community Signal rooms.

## Impact

* **Reduced moderator workload**: Automates and streamlines onboarding, allowing moderators to focus more on community engagement.
* **Increased transparency and security**: Clear event logging and validation mechanisms.
* **Scalability**: Facilitates growth by minimizing administrative overhead.
* **Enhanced user experience**: Simple, fast onboarding for new members.

## Codebase Areas to Review & Modify

* `app/ui/forms.py`: Refine user creation and invitation handling.
* `app/auth/api.py`: Enhance invite creation logic and integrate admin approval.
* `app/utils/helpers.py`: Utilize for email/Signal integration and event logging.
* `app/utils/matrix.py` & `app/utils/matrix_actions.py`: Implement automatic room joining features.
* `app/db/models.py`: Introduce `UserEvent` for logging user-initiated actions.
* `app/ui/`: Add pages for user dashboard invites and public registration.


