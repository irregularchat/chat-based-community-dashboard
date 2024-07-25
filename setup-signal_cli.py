import os
import subprocess
import platform
import shutil
import qrcode
import tempfile

def is_tool_installed(name):
    """Check if the tool is installed on the system."""
    return shutil.which(name) is not None

def install_signal_cli():
    """Install signal-cli based on the operating system."""
    os_type = platform.system()
    try:
        if os_type == "Darwin":  # macOS
            print("Installing signal-cli on macOS...")
            subprocess.check_call(["brew", "install", "signal-cli"])
        elif os_type == "Linux":  # Linux
            print("Installing signal-cli on Linux...")
            subprocess.check_call(["sudo", "apt-get", "update"])
            subprocess.check_call(["sudo", "apt-get", "install", "-y", "signal-cli"])
    except subprocess.CalledProcessError as e:
        print(f"An error occurred during installation: {e}")
        exit(1)

def link_signal_cli():
    print("Linking signal-cli to Signal Desktop...")
    try:
        print("Generating link URL...")
        result = subprocess.run(["signal-cli", "link", "-n", "signalbot"], capture_output=True, text=True, check=True)
        
        # Print stdout and stderr for debugging
        print(f"stdout: {result.stdout}")
        print(f"stderr: {result.stderr}")
        
        if result.returncode != 0:
            print(f"An error occurred: {result.stderr}")
            exit(1)
        
        link_url = result.stdout.strip()
        print(f"Link URL: {link_url}")

        # Generate QR code
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(link_url)
        qr.make(fit=True)

        img = qr.make_image(fill='black', back_color='white')
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as temp_file:
            img.save(temp_file.name)
            print(f"QR code saved to: {temp_file.name}")

        # Open the QR code image
        if platform.system() == "Darwin":  # macOS
            subprocess.run(["open", temp_file.name])
        elif platform.system() == "Linux":  # Linux
            subprocess.run(["xdg-open", temp_file.name])

    except subprocess.CalledProcessError as e:
        print(f"An error occurred during linking: {e}")
        exit(1)

def main():
    if is_tool_installed("signal-cli"):
        print("signal-cli is already installed.")
    else:
        install_signal_cli()
    print("Linking signal-cli to Signal Desktop...")
    link_signal_cli()
    print("Done.")

if __name__ == "__main__":
    main()