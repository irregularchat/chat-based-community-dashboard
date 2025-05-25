# 🤝 Contributing to Chat-Based Community Dashboard

> **Welcome!** Whether you're new to open source or a seasoned developer, we're excited to have you contribute to making community management easier for everyone.

## 🎯 Why Contribute?

- **Help real communities** - Your code will help community organizers manage their members more effectively
- **Learn new skills** - Work with modern Python, APIs, and community management tools
- **Beginner-friendly** - We provide mentoring and detailed guidance for new contributors
- **Flexible commitment** - Contribute 15 minutes or 15 hours, both are valuable!

## 🚀 Quick Start for Contributors

### 1. Set Up Your Development Environment (5 minutes)

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR-USERNAME/chat-based-community-dashboard.git
cd chat-based-community-dashboard

# Set up the environment (choose one option)

# Option A: Quick start with SQLite (easiest)
cp .env-template .env
./run_sqlite.sh

# Option B: Full setup with Docker
cp .env-template .env
# Edit .env with your API tokens (see setup guide in README)
docker-compose up -d --build
```

### 2. Verify Everything Works
- Open http://localhost:8501 in your browser
- You should see the dashboard interface
- Try creating a test user (if you have API tokens configured)

### 3. Make Your First Contribution
- Check our [good first issues](https://github.com/irregularchat/chat-based-community-dashboard/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
- Or start with documentation improvements (always needed!)

## 🕐 Contributing Based on Your Available Time

### Got 15-30 minutes?
**Perfect for beginners!** These contributions are valuable and help you get familiar with the project.

#### Documentation Improvements
- **Fix typos** in README, code comments, or documentation
- **Clarify setup instructions** - Did you get confused during setup? Help the next person!
- **Add examples** to existing documentation
- **Improve error messages** to be more helpful

#### Bug Reports
- **Test the application** and report any issues you find
- **Verify existing bug reports** - Can you reproduce them?
- **Suggest improvements** to the user interface

**How to do it:**
1. Make changes directly on GitHub (for small text changes)
2. Or clone the repo, make changes, and submit a pull request
3. No coding experience needed for documentation!

### Got 1-3 hours?
**Great for learning!** These tasks help you understand the codebase while making meaningful contributions.

#### UI/UX Improvements
- **Better error messages** - Make them more user-friendly
- **Improve form validation** - Help users avoid mistakes
- **Add loading indicators** - Show when operations are in progress
- **Enhance visual design** - Make the interface more intuitive

#### Small Bug Fixes
- **Fix issues marked "good first issue"**
- **Add input validation** to forms
- **Improve error handling** in existing functions

#### Test Coverage
- **Add tests for existing features** - Help prevent future bugs
- **Test edge cases** - What happens with invalid input?
- **Add integration tests** - Test how components work together

**Skills you'll learn:**
- Python programming
- Streamlit framework
- Testing with pytest
- Git workflow

### Got 4-8 hours?
**Perfect for feature development!** These tasks let you build substantial new functionality.

#### Core Feature Development
- **User list improvements** - Add bulk actions, better filtering
- **Email functionality** - Send emails to users from the dashboard
- **Matrix room management** - Create and manage chat rooms
- **Admin audit logging** - Track who did what when

#### API Integrations
- **Improve Authentik integration** - Better error handling, more features
- **Enhance Matrix integration** - More room management capabilities
- **Add email templates** - Standardized messages for common scenarios

**Skills you'll learn:**
- API integration
- Database design with SQLAlchemy
- Async programming
- Web application architecture

### Got 8+ hours?
**Ready for major features!** These are substantial contributions that significantly expand the platform.

#### Major New Features
- **Signal bot development** - Automated announcements and interactions
- **New platform integrations** - Discord, Slack, etc.
- **Advanced authentication** - Multi-admin support, role-based permissions
- **Mobile interface** - Responsive design for mobile devices

#### Architecture Improvements
- **Performance optimization** - Make the app faster and more scalable
- **Security enhancements** - Improve authentication and data protection
- **Code refactoring** - Improve maintainability and organization

**Skills you'll learn:**
- System architecture
- Bot development
- Advanced Python patterns
- Security best practices

## 🛠️ Development Workflow

### Setting Up for Development

1. **Fork and Clone**
   ```bash
   # Fork on GitHub, then:
   git clone https://github.com/YOUR-USERNAME/chat-based-community-dashboard.git
   cd chat-based-community-dashboard
   ```

2. **Environment Setup**
   ```bash
   # Create virtual environment
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   
   # Install dependencies
   pip3 install --upgrade pip
   pip3 install -r requirements.txt
   
   # Set up environment variables
   cp .env-template .env
   # Edit .env with your configuration
   ```

3. **Database Setup**
   ```bash
   # For SQLite (easiest)
   ./run_sqlite.sh
   
   # For PostgreSQL (full setup)
   ./run_local.sh
   ```

### Making Changes

1. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

2. **Make Your Changes**
   - Write clear, commented code
   - Follow existing code style
   - Add tests for new functionality
   - Update documentation as needed

3. **Test Your Changes**
   ```bash
   # Run tests
   python3 -m pytest tests/ -v
   
   # Test the application manually
   streamlit run app/streamlit_app.py
   ```

4. **Commit and Push**
   ```bash
   git add .
   git commit -m "Add feature: clear description of what you did"
   git push origin feature/your-feature-name
   ```

5. **Create Pull Request**
   - Go to GitHub and create a pull request
   - Fill out the template with details about your changes
   - Link any related issues

### Code Style Guidelines

- **Python**: Follow PEP 8 style guidelines
- **Comments**: Write clear comments explaining complex logic
- **Functions**: Keep functions small and focused on one task
- **Variables**: Use descriptive names
- **Error handling**: Always handle potential errors gracefully

### Testing Guidelines

- **Write tests** for new functionality
- **Test edge cases** - What happens with invalid input?
- **Manual testing** - Always test your changes in the browser
- **Test different scenarios** - Different user types, error conditions

## 🏷️ Skill Level Guidelines

### 🟢 New to Open Source?
**We're here to help!** Don't be intimidated - everyone starts somewhere.

**Start with:**
- Documentation improvements
- Bug reports
- Small UI improvements
- Testing existing features

**We provide:**
- Detailed code review and feedback
- Help with Git and GitHub workflow
- Mentoring on Python and web development
- Patient guidance through your first contributions

**Resources:**
- [First Contributions Guide](https://github.com/firstcontributions/first-contributions)
- [Git Handbook](https://guides.github.com/introduction/git-handbook/)
- [Python Tutorial](https://docs.python.org/3/tutorial/)

### 🟡 Some Programming Experience?
**Perfect!** You can tackle substantial features while learning new technologies.

**Good for:**
- Feature development
- API integrations
- Database improvements
- UI/UX enhancements

**You'll learn:**
- Streamlit web framework
- API integration patterns
- Database design with SQLAlchemy
- Testing best practices

### 🔴 Experienced Developer?
**We need your expertise!** Help us make architectural decisions and build complex features.

**Focus on:**
- System architecture
- Performance optimization
- Security improvements
- Complex integrations

**Your impact:**
- Guide technical decisions
- Mentor other contributors
- Design scalable solutions
- Review complex pull requests

## 📋 Pull Request Guidelines

### Before Submitting
- [ ] Code follows project style guidelines
- [ ] Tests pass (`python3 -m pytest tests/ -v`)
- [ ] New functionality includes tests
- [ ] Documentation is updated
- [ ] Changes are described clearly

### Pull Request Template
When you create a pull request, please include:

```markdown
## Description
Brief description of what this PR does

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Refactoring
- [ ] Other (please describe)

## Testing
- [ ] I have tested this change locally
- [ ] I have added tests for new functionality
- [ ] All existing tests pass

## Screenshots (if applicable)
Add screenshots for UI changes

## Related Issues
Closes #123 (if applicable)
```

### Review Process
1. **Automated checks** run first (tests, style checks)
2. **Code review** by maintainers
3. **Feedback and iteration** - we'll help you improve the code
4. **Merge** once everything looks good!

## 🐛 Reporting Bugs

### Before Reporting
- Check if the bug has already been reported
- Try to reproduce the bug consistently
- Test with the latest version

### Bug Report Template
```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment:**
- OS: [e.g. macOS, Windows, Linux]
- Browser: [e.g. Chrome, Firefox]
- Python version: [e.g. 3.9]

**Additional context**
Any other context about the problem.
```

## 💡 Suggesting Features

We love new ideas! Here's how to suggest features:

1. **Check existing issues** - Maybe someone already suggested it
2. **Create a feature request** with:
   - Clear description of the feature
   - Why it would be useful
   - How you imagine it working
   - Any examples from other tools

3. **Discuss with the community** - Get feedback on your idea
4. **Consider implementing it** - We'll help you get started!

## 🎉 Recognition

We believe in recognizing contributors! Here's how we show appreciation:

- **Contributors list** in README
- **Shout-outs** in release notes
- **Mentorship opportunities** for growing contributors
- **Maintainer status** for consistent, high-quality contributors

## 📞 Getting Help

**Stuck? Need guidance? Have questions?**

- **GitHub Issues** - For bugs and feature requests
- **Community Forum** - [forum.irregularchat.com](https://forum.irregularchat.com/)
- **Code Review** - We provide detailed feedback on all pull requests
- **Mentoring** - Ask for help in your pull request or issue

## 🌟 Code of Conduct

We're committed to providing a welcoming and inclusive environment for all contributors. Please:

- **Be respectful** and considerate in all interactions
- **Be patient** with new contributors learning the ropes
- **Be constructive** in feedback and criticism
- **Be collaborative** - we're all working toward the same goal

## 📚 Additional Resources

### Learning Resources
- **Streamlit Documentation**: https://docs.streamlit.io/
- **SQLAlchemy Tutorial**: https://docs.sqlalchemy.org/en/14/tutorial/
- **Matrix API Documentation**: https://matrix.org/docs/api/
- **Authentik API Documentation**: https://goauthentik.io/developer-docs/api/

### Project-Specific Guides
- **Database Schema**: See `app/db/models.py`
- **API Integration Examples**: See `app/utils/`
- **UI Components**: See `app/ui/`
- **Test Examples**: See `tests/`

---

**Ready to contribute?** 

1. 🍴 [Fork the repository](https://github.com/irregularchat/chat-based-community-dashboard/fork)
2. 🔍 [Find a good first issue](https://github.com/irregularchat/chat-based-community-dashboard/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
3. 💬 [Join our community](https://forum.irregularchat.com/) for support and discussion

**Thank you for helping make community management easier for everyone!** 🎉
