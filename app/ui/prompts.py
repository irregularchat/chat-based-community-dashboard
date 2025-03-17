import streamlit as st
from app.ui.common import display_useful_links

def get_all_prompts():
    """
    Returns a dictionary of all prompts organized by category.
    
    Returns:
        dict: A dictionary where keys are categories and values are dictionaries of prompt titles and content.
    """
    return {
        "User Management": {
            "Individual Requests to Join Chat": """You've requested to join the Irregular Chat. 

Bonafides: Everyone in the chat has been invited by another who they personally know. So that we can add you to the right groups, we need to know:
1. Who you are
2. Where you are from
3. Who invited you

As you send your intro, feel free to ask any questions about the community.""",
            
            "Bonafides": """You've requested to join the Irregular Chat. 

Bonafides: Everyone in the chat has been invited by another who they personally know. So that we can add you to the right groups, we need to know:
1. Who you are
2. Where you are from
3. Who invited you

As you send your intro, feel free to ask any questions about the community""",
            
            "Safety Number Change": """It shows that your safety number has changed. For the privacy and security of all, we ask that you provide one of the following:
- Your details. Name, organization, and who added you
- Your IrregularChat Element Messenger username that we can verify

If you don't reply to this message in 24 hours, your account will be removed from the chats, and you can request to join again when you are ready.""",
            
            "Removal due to not verifying a safety number": """NAME is being removed for not verifying themselves after their safety number changed. This is done to maintain the integrity of the community. This could mean the number was assigned to a different person or their SIM was put into a different device."""
        },
        
        "Moderation": {
            "Encourage NIPR/SIPR/JWICS for Knowledge Management": """Are you on the NIPR or higher Milsuite or Chatsurfer?

🍀 Direct NIPR Link Chatsurfer: https://url.irregular.chat/chatsurfer
Direct NIPR Link Milsuite: https://url.irregular.chat/msuite
👹 Direct SIPR Link Chatsurfer: https://chatsurfer.proj.nro.smil.mil

or search "irregular chat" on chatsurfer NIPR SIPR or higher

Perfect for sharing on the appropriate level while still breaking down silos and being found by others working on these same topics.""",
            
            "Send Off Topic": """🌟Community Reminder🌟

Hey everyone! Our group thrives on technical discussions, sharing knowledge, and building cool projects together. We're all about creating a focused and supportive environment for these activities.

We understand everyone likes a good laugh or a casual chat now and then, which is why we've got a special place just for that! 

If you're itching for off-topic banter or to share the latest meme, head over to our off-topic chat: http://url.irregular.chat/go-off-topic. 

It's the perfect spot for when you want to relax and diverge from specific topic talk.

If you're not interested in the technical aspects, no worries! We want everyone to find their best fit, and there are no hard feelings if this isn't the place for you.

Let's keep our main chat focused on tech to ensure it remains a valuable resource for everyone. 

Thanks for being such an awesome part of our journey. Let's keep pushing the boundaries of what we can achieve together! 🚀""",
            
            "Reminder to Stay on Topic": """Hey everyone! Just a friendly reminder to keep discussions in this channel focused on [TOPIC]. 

For off-topic conversations, please use our dedicated off-topic channel: http://url.irregular.chat/go-off-topic

Thanks for helping maintain the quality and focus of our community discussions!"""
        },
        
        "Announcements": {
            "New Feature Announcement": """🎉 New Feature Alert! 🎉

We're excited to announce that we've just launched [FEATURE NAME]!

This new addition will allow you to:
• [Benefit 1]
• [Benefit 2]
• [Benefit 3]

To try it out, go to [LOCATION/INSTRUCTIONS].

We'd love to hear your feedback! Please share your thoughts and suggestions in the [FEEDBACK CHANNEL].

Happy exploring!""",
            
            "Community Event": """📅 Upcoming Community Event 📅

Join us for [EVENT NAME] on [DATE] at [TIME]!

What to expect:
• [Activity/Topic 1]
• [Activity/Topic 2]
• [Activity/Topic 3]

Location: [PHYSICAL LOCATION OR VIRTUAL LINK]

Please RSVP by [DEADLINE] by [RSVP METHOD].

We look forward to seeing you there!"""
        },
        
        "Welcome Messages": {
            "New User Welcome": """Welcome to IrregularChat, {name}!

We're thrilled to have you join our community. Here are a few things to help you get started:

1. Please introduce yourself in the #introductions channel
2. Check out our community guidelines at [LINK]
3. Join channels that interest you - we have groups for various topics

If you have any questions, feel free to ask in #help or message any of our moderators.

Happy chatting!""",
            
            "Technical Channel Welcome": """Welcome to the {room_name} channel, {name}!

This space is dedicated to discussions about [TOPIC]. Feel free to ask questions, share resources, or join ongoing conversations.

A few channel-specific guidelines:
• [Guideline 1]
• [Guideline 2]
• [Guideline 3]

Enjoy the discussions!"""
        }
    }

def main():
    st.subheader("Helpful Links")
    st.markdown("""
    - [Signal Prompts from the Wiki](https://irregularpedia.org/index.php/Signal_Welcome_Prompts)
    - [Admin Prompts from the Wiki](https://irregularpedia.org/index.php/Admin)
    - [IrregularChat Forum (Mod Section)](https://forum.irregularchat.com/c/mods/3)
    """)
    
    # Display Useful Links in the sidebar
    display_useful_links()
    
    st.header("Admin Prompts (Copy & Paste for Messenger)")
    st.markdown("""
    Below are various admin prompts copied from the wiki. You can directly copy and paste them into Signal or other messaging platforms to guide community members or handle specific situations.
    """)

    # Get all prompts
    prompts = get_all_prompts()
    
    # Display prompts by category
    for category, category_prompts in prompts.items():
        st.subheader(category)
        
        for title, content in category_prompts.items():
            with st.expander(title):
                st.text_area(
                    "Copy this prompt",
                    value=content,
                    height=200,
                    key=f"prompt_{category}_{title.replace(' ', '_').lower()}"
                )

    st.header("Admin Prompts (Copy & Paste for Messenger)")
    st.markdown("""
    Below are various admin prompts copied from the wiki. You can directly copy and paste them into Signal or other messaging platforms to guide community members or handle specific situations.
    """)

    # Example of how to display these prompts. They can be grouped by categories.
    st.subheader("Individual Requests to Join Chat")
    st.markdown("""
    ```
    You've requested to join the Irregular Chat. 

    Bonafides: Everyone in the chat has been invited by another who they personally know. So that we can add you to the right groups, we need to know:
    1. Who you are
    2. Where you are from
    3. Who invited you

    As you send your intro, feel free to ask any questions about the community.
    ```
    """)

    st.subheader("Moderation Messages - Encourage NIPR/SIPR/JWICS for Knowledge Management")
    st.markdown("""
    ```
    Are you on the NIPR or higher Milsuite or Chatsurfer?

    🍀 Direct NIPR Link Chatsurfer: https://url.irregular.chat/chatsurfer
    Direct NIPR Link Milsuite: https://url.irregular.chat/msuite
    👹 Direct SIPR Link Chatsurfer: https://chatsurfer.proj.nro.smil.mil

    or search "irregular chat" on chatsurfer NIPR SIPR or higher

    Perfect for sharing on the appropriate level while still breaking down silos and being found by others working on these same topics.
    ```
    """)

    st.subheader("Send Off Topic")
    st.markdown("""
    ```
    🌟Community Reminder🌟

    Hey everyone! Our group thrives on technical discussions, sharing knowledge, and building cool projects together. We're all about creating a focused and supportive environment for these activities.

    We understand everyone likes a good laugh or a casual chat now and then, which is why we've got a special place just for that! 

    If you're itching for off-topic banter or to share the latest meme, head over to our off-topic chat: http://url.irregular.chat/go-off-topic. 

    It's the perfect spot for when you want to relax and diverge from specific topic talk.

    If you're not interested in the technical aspects, no worries! We want everyone to find their best fit, and there are no hard feelings if this isn't the place for you.

    Let's keep our main chat focused on tech to ensure it remains a valuable resource for everyone. 

    Thanks for being such an awesome part of our journey. Let's keep pushing the boundaries of what we can achieve together! 🚀
    ```
    """)


    st.subheader("Bonafides")
    st.markdown("""
    ```
    You've requested to join the Irregular Chat. 

    Bonafides: Everyone in the chat has been invited by another who they personally know. So that we can add you to the right groups, we need to know:
    1. Who you are
    2. Where you are from
    3. Who invited you

    As you send your intro, feel free to ask any questions about the community
    ```
    """)

    st.subheader("Safety Number Change")
    st.markdown("""
    ```
    It shows that your safety number has changed. For the privacy and security of all, we ask that you provide one of the following:
    - Your details. Name, organization, and who added you
    - Your IrregularChat Element Messenger username that we can verify

    If you don't reply to this message in 24 hours, your account will be removed from the chats, and you can request to join again when you are ready.
    ```
    """)

    st.subheader("Removal due to not verifying a safety number")
    st.markdown("""
    ```
    NAME is being removed for not verifying themselves after their safety number changed. This is done to maintain the integrity of the community. This could mean the number was assigned to a different person or their SIM was put into a different device. 

    They are welcome to request to join anytime but will need to be verified by knowing someone in the community and providing their name and organization.
    ```
    """)


    st.header("Admin Signal Welcome Prompts")
  

    st.subheader("Ask Individuals to Introduce Themselves")
    st.markdown("""
    **Tech Chat Intro:**
    ```
    🚀 Welcome to the Tech Chat! 🚀

    As you join us, please take a moment to browse the user list and introduce yourself. We're excited to learn about your tech training, interests, and projects. This is a great opportunity to self-promote and share your tech projects or ask a question to the community.

    - Resources for Learning: https://irregularpedia.org/index.php/Learning

    Expectation Management: This group fosters a focused environment for general tech discussions. Off-topic banter is directed to our Off-Topic Chat, where you can freely share and enjoy less technical content. This approach helps us maintain the quality and relevance of discussions for everyone's benefit.

    Thank you for joining us, and we look forward to your contributions!
    ```
    """)

    st.subheader("Influence Chat Intro")
    st.markdown("""
    ```
    🚀 Welcome to the Influence Chat! 🚀
    Please take a moment to look around and introduce yourself to the group.

    We love reading articles, dissertations, and white papers on influence, behavior change models, social movements, and related studies or news; please share something with the group.

    Check out some resources: https://irregularpedia.org/index.php/Learning
    National Strategic Documents and Reports: https://irregularpedia.org/index.php/National_Strategy_and_Reports

    See all the community chats: https://forum.irregularchat.com/t/229
    ```
    """)

    st.subheader("Innovation Chat Bonafide")
    st.markdown("""
    ```
    You requested to join the innovation chat. Are you currently in a unit supporting 1SFC or USASOC? All chat members have been validated.

    Your request will be rejected if you don't reply to this message in 24 hours. You can request again when you are ready.
    ```
    """)

    st.subheader("Innovation Chat Greeting")
    st.markdown("""
    ```
    🚀 Welcome to the unofficial 1SFC/USASOC Innovation Chat! 🚀
    The chat is focused on innovative efforts that directly benefit the command and units; see the group description for more information.

    Please take a moment to introduce yourself and include at least the following:
    1. What innovative projects are you or your unit currently exploring?
    2. Have you identified capability gaps that might impact your unit or mission?
    3. How do you understand the process for submitting innovation requirements?

    Beyond daily engagement, we'd now love to hear from you or others who may want to collaborate with your efforts.

    Please remember that this chat is strictly for unclassified discussions. For CUI SOCOM Teams: https://go.intellink.gov/1sfc_g8
    ```
    """)

    st.subheader("Research & Data Chat Intro")
    st.markdown("""
    ```
    🧐 Welcome to the Research Chat! 📚
    Share some of your relative research background, interests in research, and research projects! What are you currently researching, and how can we help?

    Remember the forum is unclassified, and use any DM for advanced sharing of PII and contact information.
    Help Expand the known resources by reviewing:  https://irregularpedia.org/index.php/Category:Research

    Let us know what sections or resources should be included for research and planning.
    ```
    """)

    st.subheader("AI/ML Chat Intro")
    st.markdown("""
    ```
    📊 Welcome to the AI/ML Chat! 🤖
    Share your relevant background, interests, and AI/ML/DATA projects!

    Remember, the forum is unclassified, so use any DM to share PII and contact information in advance. Help expand the knowledge base on the wiki:
    AI/ML Wiki - https://irregularpedia.org/index.php/Category:AI
    AI/ML Forum: https://forum.irregularchat.com/tag/ai
    ```
    """)

    st.subheader("DragonOS Chat Intro")
    st.markdown("""
    ```
    🐉 Welcome to the DragonOS Chat! 🐉
    Feel free to ask questions, provide feedback, or just lurk. Please introduce yourself and let us know how you use DragonOS in your hobbies or work.
    Which SDR do you currently own?

    - YouTube channel: https://youtube.com/@cemaxecuter7783/
    - X: https://twitter.com/cemaxecuter/
    - Download ISO: http://url.irregular.chat/dragon-download
    - Wiki Section: https://irregularpedia.org/index.php/DragonOS

    See all the community chats: https://forum.irregularchat.com/t/229
    ```
    """)

    st.subheader("sUAS - Unmanned Systems Chat Intro")
    st.markdown("""
    ```
    🤖 Welcome to the Unmanned Systems Chat! 🚁
    Welcome to the chat. Please share some of your relative background, interests, and projects with the community of hobbyists chatting in their free time.

    Remember, the forum is unclassified, so use any DM to share PII and contact information in advance.

    Resources, Guides, and precious gems from the conversation can be found and edited here https://irregularpedia.org/index.php/Unmanned_Systems

    Previously shared files are found here - http://url.irregular.chat/unmanned
    the password, with spaces, is:

    Anymore01!@Shadow01!@Unkempt
    ```
    """)

    st.subheader("Counter UxS Chat Intro")
    st.markdown("""
    ```
    🚀 Welcome to the C-UxS Chat! 🚀
    Please take a moment to look around and introduce yourself to the group.

    We are here because we love stopping and breaking drones, monitoring advances on the emerging threat from red unmanned systems, from real cutting-edge technologies to modeling and simulation for the counter perspective of air, sea, land, sub-sea, and space. Please share something with the group.

    Check out some resources for learning shared with the group: https://irregularpedia.org/index.php/Learning

    See all the community chats: https://forum.irregularchat.com/t/229
    ```
    """)

    st.subheader("Fabrication Chat Intro")
    st.markdown("""
    ```
    ⚙️ Welcome to the Fabrication Chat! 🛠️

    Jump in and share your fabrication skills, projects, and questions, from 3D printing to metalwork! Start by introducing yourself and your projects.

    📝 : Help grow our knowledge base! Add to the Fabrication Wiki at irregularpedia.org/index.php/Category:Fabrication or contribute to the NIPR Inteldocs at go.intelink.gov/I7IjyTL.
    ```
    """)

    st.subheader("Off-Topic Chat Intro")
    st.markdown("""
    ```
    If it's your first day in off-topic chat, you gotta meme.

    Beyond memes, this is open to creative discussion, gaming, venting, successes and failures, and back and forths, not focused on tech, influence, research, or other focused themes.

    Nothing Illegal, Classified, or Unethical is allowed, but as you'll see, there is still a lot of room for fun.

    See all the community chats: https://forum.irregularchat.com/t/229
    ```
    """)

    st.subheader("Purple Teaming Chat Intro")
    st.markdown("""
    ```
    🗡️ Welcome to the Purple Team Community Chat! 🛡️🕵️‍♂️

    - Introduce Yourself: Tell us about your experience and what draws you to red or blue teaming.
    - Share and Learn: Utilize the wiki to access and contribute to our growing list of resources and guides.
    - Engage: Share information on upcoming workshops, events, and your red teaming projects.
    Please remember that all discussions here should remain within consensual boundaries and be suitable for an unclassified forum.

    Which is your interest?
    Red Team:
    - https://irregularpedia.org/index.php/Cyber_Red_Teaming
    Blue Team:
    - https://irregularpedia.org/index.php/DFP_Guide
    - https://irregularpedia.org/index.php/Cyber_Incident_Response_Guide_(Personal)

    See all the community chats: https://forum.irregularchat.com/t/229
    ```
    """)

    st.subheader("Business Chat Intro")
    st.markdown("""
    ```
    Welcome to the Business Chat, a specialized haven for service members and veterans navigating the civilian business landscape.

    Introduce yourself, share your experiences, and outline your aspirations. For archived resources, connections, and opportunities, visit https://irregularpedia.org/index.php/Business.

    Previous intros can be found here: https://forum.irregularchat.com/t/business-chat-introductions/100

    To maintain the community's essence, avoid spam or excessive promotions

    See all the community chats: https://forum.irregularchat.com/t/229
    ```
    """)

    st.subheader("Cert Chat Intro")
    st.markdown("""
    ```
    📚 To kickstart or enhance your journey, we've compiled various resources. Whether you're new or seasoned, these will surely add value:
    - General Learning Resources: https://irregularpedia.org/index.php/Learning
    - Guides and Resources for Certification Pathways: https://irregularpedia.org/index.php/Certifications

    💬 Introduce yourself! Share what certifications you're pursuing, your learning methods, and any questions or insights.

    See all the community chats: https://forum.irregularchat.com/t/229
    ```
    """)

    st.subheader("Debate Chat Intro")
    st.markdown("""
    ```
    1. State Your Initial Position: Brief and Clear. Max Two Sentences.
    2. Create an Ephemeral Notepad and Post the Link: https://url.irregular.chat/debate-template
    3. Open the Floor for Questions and join Sides from ALL.
    4. 10-Minute Argument Submission: post your argument Supporting your position.
    5. Sides are defined. Only participants can ask questions beyond this point.
    6. Respectful Debate:
       • Provide emoji to show support, questions, and objection
       • Only those with a stated position may make arguments. All can ask questions that can be direct but may be answered by either party.
       • Each side will then engage in a constructive and respectful debate.

    Let's rumble!
    ```
    """)

    st.subheader("FLNC Chat Intro")
    st.markdown("""
    ```
    🗽 Welcome to the FLNC chat 🇺🇸
    Please introduce yourself AND provide a piece of value you think members around Liberty would benefit from. Resources, Tips, Recommendations, Opportunities

    You may be invited to join more topic-focused irregularchats based on your hobbies and interests.

    See all the community chats: https://forum.irregularchat.com/t/229/
    ```
    """)

    st.subheader("NCR Chat Intro")
    st.markdown("""
    ```
    🏛️ Welcome to the National Capital Region chat 📜
    Please introduce yourself AND provide a piece of value you think members around NCR would benefit from such as Resources, Tips, Recommendations, Opportunities

    You may be invited to join more topic-focused irregularchats based on your hobbies and interests.

    See all the community chats: https://forum.irregularchat.com/t/229
    ```
    """)

    st.subheader("Domestic Issues (Politics) Chat Intro")
    st.markdown("""
    ```
    Welcome to the Domestic Issues Chat! Here, we tackle political, religious, and other partisan topics with open minds and respectful dialogue. While serious discussion is encouraged, satire, jokes, and memes related to these topics are also welcome.

    Feel free to share your perspectives and engage in debates, but remember: thoughtful pushback is part of the conversation.

    You can find previous topics here: https://forum.irregularchat.com/c/community/8
    ```
    """)

    st.subheader("Modern Warfare Chat Intro")
    st.markdown("""
    ```
    Welcome to the Modern Warfare Chat! This space is dedicated to UNCLASSIFIED discussing current and future conflicts, focusing on tactics, strategy, and warfighting at all levels.

    Feel free to share insights, ask questions, or debate concepts related to modern warfare—from recent engagements to future battlegrounds.

    Whether you're diving into real-world strategy or contemplating future warfare scenarios, this is the place for deep UNCLASSIFIED discussion and exploration.

    There are separate chats for unmanned systems, RF/EW, Tech, AI, etc. https://forum.irregularchat.com/t/229/
    ```
    """)

