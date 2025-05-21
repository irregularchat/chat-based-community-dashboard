# SMTP Testing

This directory contains tests for the application's email functionality, particularly focusing on SMTP-related features when creating users and sending welcome emails.

## Test Files

- `test_smtp.py` - Basic tests for SMTP server connection
- `test_user_email.py` - Tests for email functionality when creating users
  - Tests the `send_email` function
  - Tests the `community_intro_email` function
  - Tests email sending when creating users
  - Tests error handling for SMTP issues

## Running the Tests

We provide a dedicated script `run_smtp_tests.py` in the project root directory that can run the SMTP tests in two modes:

### Mock Mode (Default)

To run tests with mocked SMTP functionality (no real emails sent):

```bash
./run_smtp_tests.py
```

or

```bash
python3 run_smtp_tests.py
```

### Real SMTP Mode

To test against a real SMTP server (using your configured .env values):

```bash
./run_smtp_tests.py --real --email your.email@example.com
```

This will send actual test emails to the specified address.

### Verbose Output

Add the `-v` flag for more detailed test output:

```bash
./run_smtp_tests.py -v
```

## Test Environment

The SMTP tests use the following from your environment:

- In mock mode: Tests use mocked SMTP server
- In real mode: Tests use settings from your `.env` file:
  - `SMTP_SERVER`
  - `SMTP_PORT`
  - `SMTP_USERNAME`
  - `SMTP_PASSWORD`
  - `SMTP_FROM_EMAIL`

## Adding More Tests

When adding more SMTP-related tests:

1. Add your test file or modify existing test files
2. Update the `run_smtp_tests.py` script to include your new test files
3. Run the tests to ensure they pass in both mock and real modes

## Troubleshooting

If you encounter issues with the tests:

- Check your `.env` file for proper SMTP configuration
- Ensure your SMTP server is correctly configured and accessible
- Look for detailed error messages in the test output 