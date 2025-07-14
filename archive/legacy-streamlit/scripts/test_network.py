#!/usr/bin/env python3
"""
Network connectivity test script for IrregularChat Dashboard.
Tests connectivity to key services and provides diagnostic information.
"""

import requests
import socket
import time
import sys
from urllib.parse import urlparse

def test_dns_resolution(hostname):
    """Test DNS resolution for a hostname"""
    print(f"🔍 Testing DNS resolution for {hostname}...")
    try:
        ip_addresses = socket.gethostbyname_ex(hostname)[2]
        print(f"✅ DNS resolution successful: {hostname} -> {ip_addresses}")
        return True
    except socket.gaierror as e:
        print(f"❌ DNS resolution failed: {e}")
        return False

def test_http_connectivity(url, timeout=10):
    """Test HTTP connectivity to a URL"""
    print(f"🌐 Testing HTTP connectivity to {url}...")
    
    try:
        # First try with SSL verification
        response = requests.get(url, timeout=timeout, verify=True)
        print(f"✅ HTTP connectivity successful: Status {response.status_code}")
        return True
    except requests.exceptions.SSLError:
        # SSL error - try without verification
        print(f"⚠️  SSL verification failed, trying without verification...")
        try:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            
            response = requests.get(url, timeout=timeout, verify=False)
            print(f"✅ HTTP connectivity successful (no SSL verification): Status {response.status_code}")
            return True
        except Exception as fallback_err:
            print(f"❌ HTTP connection failed even without SSL verification: {fallback_err}")
            return False
    except requests.exceptions.ConnectTimeout:
        print(f"❌ HTTP connection timeout after {timeout} seconds")
        return False
    except requests.exceptions.ConnectionError as e:
        print(f"❌ HTTP connection error: {e}")
        return False
    except requests.exceptions.RequestException as e:
        print(f"❌ HTTP request error: {e}")
        return False

def test_authentik_api(api_url, token):
    """Test Authentik API connectivity"""
    print(f"🔐 Testing Authentik API connectivity...")
    
    headers = {
        'Authorization': f"Bearer {token}",
        'Content-Type': 'application/json'
    }
    
    try:
        # First try with SSL verification
        response = requests.get(f"{api_url}/core/groups/", headers=headers, timeout=10, verify=True)
        if response.status_code == 200:
            groups = response.json().get('results', [])
            print(f"✅ Authentik API accessible: Found {len(groups)} groups")
            return True
        else:
            print(f"❌ Authentik API error: Status {response.status_code}")
            return False
    except requests.exceptions.SSLError:
        # SSL error - try without verification
        print(f"⚠️  SSL verification failed, trying without verification...")
        try:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            
            response = requests.get(f"{api_url}/core/groups/", headers=headers, timeout=10, verify=False)
            if response.status_code == 200:
                groups = response.json().get('results', [])
                print(f"✅ Authentik API accessible (no SSL verification): Found {len(groups)} groups")
                return True
            else:
                print(f"❌ Authentik API error: Status {response.status_code}")
                return False
        except Exception as fallback_err:
            print(f"❌ Authentik API connection failed even without SSL verification: {fallback_err}")
            return False
    except Exception as e:
        print(f"❌ Authentik API connection failed: {e}")
        return False

def main():
    """Main test function"""
    print("🚀 IrregularChat Dashboard Network Connectivity Test")
    print("=" * 50)
    
    # Test domains
    domains = [
        "sso.irregularchat.com",
        "forum.irregularchat.com", 
        "matrix.irregularchat.com",
        "irregularchat.com"
    ]
    
    # Test DNS resolution
    print("\n📡 DNS Resolution Tests:")
    dns_results = {}
    for domain in domains:
        dns_results[domain] = test_dns_resolution(domain)
    
    # Test HTTP connectivity
    print("\n🌐 HTTP Connectivity Tests:")
    http_urls = [
        "https://sso.irregularchat.com",
        "https://forum.irregularchat.com",
        "https://matrix.irregularchat.com"
    ]
    
    http_results = {}
    for url in http_urls:
        domain = urlparse(url).netloc
        if dns_results.get(domain, False):  # Only test if DNS works
            http_results[url] = test_http_connectivity(url)
        else:
            print(f"⚠️  Skipping HTTP test for {url} due to DNS failure")
            http_results[url] = False
    
    # Test Authentik API if possible
    print("\n🔐 Authentik API Test:")
    if dns_results.get("sso.irregularchat.com", False):
        # Load config to test API
        try:
            import sys
            import os
            sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
            from app.utils.config import Config
            
            if Config.AUTHENTIK_API_URL and Config.AUTHENTIK_API_TOKEN:
                api_result = test_authentik_api(Config.AUTHENTIK_API_URL, Config.AUTHENTIK_API_TOKEN)
            else:
                print("⚠️  Authentik API credentials not configured")
                api_result = False
        except ImportError:
            print("⚠️  Could not load config, skipping API test")
            api_result = False
    else:
        print("⚠️  Skipping Authentik API test due to DNS failure")
        api_result = False
    
    # Summary
    print("\n📊 Test Summary:")
    print("=" * 30)
    
    dns_passed = sum(dns_results.values())
    http_passed = sum(http_results.values())
    
    print(f"DNS Tests: {dns_passed}/{len(domains)} passed")
    print(f"HTTP Tests: {http_passed}/{len(http_urls)} passed")
    print(f"API Test: {'✅ Passed' if api_result else '❌ Failed'}")
    
    if dns_passed == len(domains) and http_passed == len(http_urls) and api_result:
        print("\n🎉 All tests passed! Network connectivity is working properly.")
        return 0
    else:
        print("\n⚠️  Some tests failed. Check your network connection and configuration.")
        return 1

if __name__ == "__main__":
    sys.exit(main()) 