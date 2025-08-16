import streamlit as st
from app.ui.common import display_useful_links

def main():
    st.title("Help & Resources")

    st.write("This page is designed to assist admins who are unfamiliar with Authentik and the administrative workflows in this platform. Below you'll find instructions, video tutorials, and copyable text snippets to use in signal messenger or other platforms.")
    
    # Display Useful Links in the sidebar
    display_useful_links()
    
    st.header("Step-by-Step Instructions")
    st.subheader("1. How to Reset a Password")
    st.markdown("""
    **Instructions:**
    1. Navigate to the "List and Manage Users" section.
    2. Find the user whose password you want to reset.
    3. Select the user and choose the "Reset Password" action from the dropdown.
    4. If using the password generator, it will automatically create a secure passphrase. Otherwise, enter a new password.
    5. Click "Apply" to finalize the change.

    *Tip:* Ensure the user receives their new password via a secure channel.
    """)

    st.subheader("2. How to Create an Invite")
    st.markdown("""
    **Instructions:**
    1. Go to the "Create Invite" section.
    2. Enter a label for the invite and an expiration time.
    3. Click "Submit" to generate a unique invite link.
    4. Share this invite link with the intended user to grant them access.

    *Tip:* Set a reasonable expiration to maintain security and avoid old, unused invite links lingering indefinitely.
    """)

    st.subheader("3. How to Create a New User")
    st.markdown("""
    **Instructions:**
    1. Navigate to the "Create User" section.
    2. Input a username, first name, and/or last name.
    3. (Optional) Add an email, invited by info, and an intro.
    4. Click "Submit" to create the user. The system will generate a temporary password if one isn't provided.
    5. Provide the user with their credentials and encourage them to reset their password on first login.
    """)

    st.subheader("4. List and Manage Users")
    st.markdown("""
    **Instructions:**
    1. Go to the "List and Manage Users" section.
    2. Use the search field to find users by username or email.
    3. Select one or more users from the displayed table.
    4. Choose an action: Activate, Deactivate, Reset Password, Delete, Add Intro, or Add Invited By.
    5. Click "Apply" to perform the action on the selected users.

    *Tip:* Use the pagination and filters to quickly navigate large user lists.
    """)

    st.header("Video Tutorials")
    st.markdown("""
    **MAYBE Coming:**  
    [Watch Tutorial](#) (Replace # with actual video URL)

    *Note:* These videos provide a quick walk-through of the steps outlined above.
    """)


    st.markdown("""
    *Scroll up to see detailed instructions, video tutorials, and a wide range of admin prompts available for quick copying.*
    """)