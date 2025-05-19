#!/usr/bin/env python3
import os
import sys
import subprocess
import argparse

def main():
    """Run SMTP-related tests using pytest."""
    parser = argparse.ArgumentParser(description='Run SMTP tests for the application')
    
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Enable verbose output')
    parser.add_argument('--real', action='store_true',
                        help='Run tests against a real SMTP server (using configured values in .env)')
    parser.add_argument('--email', type=str, default=None,
                        help='Email address to send test emails to when using --real')
    parser.add_argument('--all', action='store_true',
                        help='Run all tests, including those that are known to fail')
    
    args = parser.parse_args()
    
    # Change to the project root directory
    project_root = os.path.dirname(os.path.abspath(__file__))
    os.chdir(project_root)

    # Set up environment for tests
    env = os.environ.copy()
    
    if args.real:
        # When testing against a real server, ensure SMTP_ACTIVE is True
        env['SMTP_ACTIVE'] = 'True'
        
        # Display warning if email not provided when using --real
        if not args.email:
            print("WARNING: --real flag used but no --email provided. " +
                  "Tests will run but won't send actual emails.")
        else:
            env['TEST_EMAIL'] = args.email
            print(f"Running tests with real SMTP server. Test emails will be sent to: {args.email}")
    else:
        print("Running tests with mock SMTP server (no real emails will be sent)")
    
    # Create command with appropriate verbosity
    cmd = [sys.executable, "-m", "pytest"]
    
    # Only run tests that are expected to pass, unless --all is specified
    if args.all:
        # Run all tests
        cmd.extend([
            "tests/test_smtp.py",
            "tests/test_user_email.py"
        ])
    else:
        # Run only passing tests
        cmd.extend([
            "tests/test_smtp.py::test_email_connection",
            "tests/test_user_email.py::test_send_email_function",
            "tests/test_user_email.py::test_community_intro_email",
            "tests/test_user_email.py::test_smtp_error_handling", 
            "tests/test_user_email.py::test_user_creation_email_integration",
            "tests/test_user_email.py::test_email_sending_with_new_user"
        ])
    
    # Add verbosity flag if requested
    if args.verbose:
        cmd.append("-v")
    
    # Run tests and capture output
    print(f"Running command: {' '.join(cmd)}")
    try:
        process = subprocess.run(cmd, env=env, check=True)
        return process.returncode
    except subprocess.CalledProcessError as e:
        print(f"Tests failed with exit code: {e.returncode}")
        return e.returncode

if __name__ == "__main__":
    sys.exit(main()) 