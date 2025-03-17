from setuptools import setup, find_packages

setup(
    name="chat-based-community-dashboard",
    version="0.1",
    packages=find_packages(),
    install_requires=[
        "streamlit",
        "pytest",
        "pytest-asyncio",
        "pytest-cov",
        "pytest-mock",
        # Add other dependencies as needed
    ],
) 