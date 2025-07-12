"""
Network connectivity tests for the application.
"""
import socket
import requests
import urllib3
import sys
import os

def test_dns_resolution(domain, timeout=5):
    """Test DNS resolution for a domain."""
    try:
        socket.gethostbyname(domain)
        print(f"✅ DNS resolution successful for {domain}")
        return True
    except socket.gaierror:
        print(f"❌ DNS resolution failed for {domain}")
        return False

def test_http_connectivity(url, timeout=10):
    """Test HTTP connectivity to a URL"""
    print(f"Testing HTTP connectivity to {url}...")
    
    try:
        # First try with SSL verification
        response = requests.get(url, timeout=timeout, verify=True)
        print(f"✅ HTTP connectivity successful: Status {response.status_code}")
        return True
    except requests.exceptions.SSLError:
        # SSL error - try without verification
        print(f"⚠️  SSL verification failed, trying without verification...")
        try:
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
    print(f"Testing Authentik API connectivity...")
    
    headers = {
        'Authorization': f"Bearer {token}",
        'Content-Type': 'application/json'
    }
    
    try:
        response = requests.get(f"{api_url}/core/groups/", headers=headers, timeout=10, verify=True)
        if response.status_code == 200:
            groups = response.json().get('results', [])
            print(f"✅ Authentik API accessible: Found {len(groups)} groups")
            return True
        else:
            print(f"❌ Authentik API error: Status {response.status_code}")
            return False
    except requests.exceptions.SSLError:
        try:
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
    print("🚀 Network Connectivity Test")
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
        http_results[url] = test_http_connectivity(url)
    
    # Test API connectivity if token is provided
    api_token = os.environ.get("AUTHENTIK_TOKEN")
    api_result = False
    if api_token:
        print("\n🔐 Testing Authentik API connectivity...")
        api_result = test_authentik_api("https://sso.irregularchat.com", api_token)
    else:
        print("\n⚠️  No AUTHENTIK_TOKEN found in environment, skipping API test")
    
    # Print summary
    print("\n📊 Test Summary:")
    print("=" * 30)
    
    dns_passed = sum(dns_results.values())
    http_passed = sum(http_results.values())
    
    print(f"DNS Tests: {dns_passed}/{len(domains)} passed")
    print(f"HTTP Tests: {http_passed}/{len(http_urls)} passed")
    if api_token:
        print(f"API Test: {'✅ Passed' if api_result else '❌ Failed'}")
    
    if dns_passed == len(domains) and http_passed == len(http_urls) and (not api_token or api_result):
        print("\n🎉 All tests passed! Network connectivity is working properly.")
        return 0
    else:
        print("\n⚠️  Some tests failed. Check your network connection and configuration.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
