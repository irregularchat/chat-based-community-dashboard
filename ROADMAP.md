# Project Roadmap: Chat-Based Community Dashboard

This roadmap outlines the key features and milestones planned for the Chat-Based Community Dashboard project. Each task is designed to enhance functionality, streamline user management, and improve community engagement.

## Features and Milestones


- [ ] **Fix List of Users**
   - Fix the list of users to allow actions on the users selected.
      - Actions include: 
         - Activate / Deactivate
         - Change Password
         - Delete
         - Safety Number Verification
         - Add Intro 
         - Add Email

- [ ] **Admin Email to User Email**
   - Add a way to send an email to a user from the dashboard.
     - Email would come from admin smtp account 

- [ ] **User accounts on dashboard**
   - Accounts would allow for tracking which admin did which actions. 


- [ ] **Verification Email Process**
   - Implement an automated email verification system to streamline user onboarding.
     - Currently using AWS SES for email sending. 
     - Possible flow for Authentik to create this verification method. 
     	 - default-enrollment-email-verification or similar but will need an option to add email and send verification email for the many users who don't have an email or account. 

- [ ] **Integration of Other Identity Managers**
   - Add options for identity management, starting with APIs such as Keycloak.

- [ ] **Signal Bot Launch**
   - Provide a customizable Signal bot for announcements, updates, and user interactions.
     - This signal bot would be a dependency of the dashboard. 

- [ ] **Maubot Integration**
   - Enable Maubot for Matrix to automate interactions and enhance community engagement.

- [ ] **Global Announcements via API or Webhooks**
   - Add the ability to send announcements across all rooms using APIs or webhooks.

- [ ] **Room Management Tools**
   - Maintain a list of all rooms for easier tracking and management.
   - Add users to rooms programmatically or via admin commands.
   - Remove users from rooms programmatically or via admin commands.
   - Admin announcements to all rooms. 
   - Create Rooms and invite users to them see (Quick Creation of Conflict Rooms)

- [ ] **Chat-Based Account Management**
   - Allow admin user accounts to create accounts, reset passwords, or update credentials using chat-based subcommands.

- [ ] **Quick Creation of Conflict Rooms**
   - Add functionality to create a conflict resolution room quickly, automatically adding all moderators and the relevant individual(s) into a private space.

- [ ] **Direct Messaging for Account Support**
   - Enable admins to send users direct messages containing account creation details or verification steps.

---

This roadmap serves as a guide to track progress and ensure key objectives are met. Each feature is critical to improving the user experience and operational efficiency of the Chat-Based Community Dashboard.