import random
from xkcdpass import xkcd_password as xp

# Locate the default wordlist provided by xkcdpass
wordfile = xp.locate_wordfile()

# Generate a wordlist with words of length between 5 and 8 characters
wordlist = xp.generate_wordlist(wordfile=wordfile, min_length=3, max_length=6)

# Create a passphrase using 4 words and optional special characters
def generate_secure_passphrase():
    # Generate a random number to use as part of the delimiter
    random_number = str(random.randint(10, 99))  # Generates a 2-digit number

    # Use the random number as a delimiter
    delimiter = random_number

    # Generate the passphrase with the random number as the delimiter
    passphrase = xp.generate_xkcdpassword(wordlist, numwords=2, delimiter=delimiter)

    return passphrase
# Example of generating a secure passphrase
secure_passphrase = generate_secure_passphrase()
print(f"Generated passphrase: {secure_passphrase}")