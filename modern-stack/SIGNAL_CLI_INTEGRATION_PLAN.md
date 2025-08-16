# Signal CLI Bot Integration Plan

## Overview

This plan outlines the integration of Signal CLI as a direct dependency using Docker containers to replace Matrix-Signal bridge functions for improved reliability, performance, and simplified architecture.

## Research Summary

### Signal CLI REST API Options

**Primary Choice: `bbernhard/signal-cli-rest-api`**
- Most actively maintained and documented
- REST API wrapper around signal-cli
- Supports multiple modes: normal, json-rpc, native
- Active community and regular updates
- Comprehensive API documentation

**Alternative: Official GitLab Registry**
- `registry.gitlab.com/packaging/signal-cli/signal-cli-native:latest`
- Direct signal-cli access via JSON-RPC
- Lower-level control but more complex integration

## Architecture Plan

### 1. Docker Integration Strategy

#### Docker Compose Configuration
```yaml
# Add to existing docker-compose.yml
services:
  signal-cli-rest-api:
    image: bbernhard/signal-cli-rest-api:latest
    container_name: community-dashboard-signal
    environment:
      - MODE=normal
      - SIGNAL_CLI_UID=1000
      - SIGNAL_CLI_GID=1000
    ports:
      - "8080:8080"  # Internal only, not exposed to host
    volumes:
      - signal-cli-data:/home/.local/share/signal-cli
    networks:
      - dashboard-network
    restart: unless-stopped
    depends_on:
      - postgres

volumes:
  signal-cli-data:
    driver: local

networks:
  dashboard-network:
    driver: bridge
```

#### Production Considerations
- Use internal Docker network (no host port exposure)
- Volume persistence for Signal CLI data
- Health checks and restart policies
- Environment-specific configurations

### 2. Service Architecture

#### New SignalBotService Class
```typescript
// src/lib/signal/signal-bot-service.ts
interface SignalBotConfig {
  apiUrl: string;
  phoneNumber: string;
  isRegistered: boolean;
  timeout: number;
}

interface SignalMessage {
  message: string;
  recipients: string[];
  attachments?: string[];
}

interface SignalResult {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: Date;
}

class SignalBotService {
  private config: SignalBotConfig;
  private httpClient: AxiosInstance;

  // Account Management
  async registerPhoneNumber(phoneNumber: string, useVoice?: boolean): Promise<void>;
  async verifyRegistration(phoneNumber: string, code: string, pin?: string): Promise<void>;
  async getAccountInfo(): Promise<SignalAccount>;
  
  // Messaging Operations
  async sendMessage(phoneNumber: string, message: string): Promise<SignalResult>;
  async sendMessageToMultiple(recipients: string[], message: string): Promise<SignalResult>;
  async resolvePhoneToUuid(phoneNumber: string): Promise<string | null>;
  
  // Service Management
  async checkServiceHealth(): Promise<boolean>;
  async getRegistrationStatus(): Promise<boolean>;
}
```

### 3. Configuration Management

#### Environment Variables
```bash
# Add to .env.local
SIGNAL_CLI_ENABLED=true
SIGNAL_CLI_API_URL=http://signal-cli-rest-api:8080
SIGNAL_CLI_PHONE_NUMBER=+1234567890
SIGNAL_CLI_TIMEOUT=30000
SIGNAL_CLI_REGISTRATION_PIN=
```

#### Admin Configuration Interface
```typescript
// Add to admin configuration page
interface SignalCliConfig {
  enabled: boolean;
  apiUrl: string;
  phoneNumber: string;
  isRegistered: boolean;
  lastSyncTime?: Date;
}
```

### 4. API Integration Layer

#### REST API Endpoints Wrapper
```typescript
// Core endpoints implementation
class SignalApiClient {
  // Phone Registration
  async register(phoneNumber: string, useVoice = false): Promise<void> {
    const url = `/v1/register/${phoneNumber}`;
    await this.post(url, { use_voice: useVoice });
  }

  async verify(phoneNumber: string, code: string, pin?: string): Promise<void> {
    const url = `/v1/register/${phoneNumber}/verify/${code}`;
    await this.post(url, pin ? { pin } : {});
  }

  // Message Sending
  async sendMessage(sender: string, recipients: string[], message: string): Promise<SignalResult> {
    const url = '/v2/send';
    return await this.post(url, {
      number: sender,
      recipients,
      message
    });
  }

  // Account Info
  async getIdentities(phoneNumber: string): Promise<any> {
    const url = `/v1/identities/${phoneNumber}`;
    return await this.get(url);
  }
}
```

## Implementation Phases

### Phase 1: Infrastructure Setup (Week 1)
- [ ] Add Signal CLI REST API to Docker Compose
- [ ] Create basic SignalBotService skeleton
- [ ] Add environment configuration
- [ ] Set up internal Docker networking
- [ ] Create health check endpoints

### Phase 2: Core Service Development (Week 2)
- [ ] Implement SignalApiClient wrapper
- [ ] Create phone number registration flow
- [ ] Build message sending functionality
- [ ] Add error handling and logging
- [ ] Write unit tests for core functions

### Phase 3: Integration & Admin UI (Week 3)
- [ ] Add Signal CLI configuration to admin dashboard
- [ ] Implement registration wizard UI
- [ ] Create service status monitoring
- [ ] Add Signal CLI settings to database
- [ ] Integrate with existing phone verification flow

### Phase 4: Migration & Testing (Week 4)
- [ ] Create migration path from Matrix Signal bridge
- [ ] Add feature flag for Signal CLI vs Matrix bridge
- [ ] Comprehensive integration testing
- [ ] Performance testing and optimization
- [ ] Documentation and deployment guides

## Registration & Setup Flow

### Initial Setup Process
1. **Docker Container Deployment**
   - Signal CLI REST API container starts
   - Service health check confirms availability
   - Admin dashboard shows "Not Registered" status

2. **Phone Number Registration**
   - Admin enters phone number in configuration
   - System calls `/v1/register/{phoneNumber}` endpoint
   - SMS/Voice verification code sent to phone

3. **Verification Completion**
   - Admin enters verification code
   - System calls `/v1/register/{phoneNumber}/verify/{code}`
   - Registration status updated to "Active"

4. **Service Activation**
   - Phone verification functions switch to Signal CLI
   - Matrix integration maintained for other features
   - Monitoring and logging activated

### QR Code Linking (Alternative)
- For linking as secondary device
- Open `http://localhost:8080/v1/qrcodelink?device_name=dashboard-bot`
- Scan QR with primary Signal device
- Automatic activation upon successful linking

## Security Considerations

### Data Protection
- Signal CLI data volume encryption
- Secure API key management
- Internal network isolation
- Regular security updates

### Access Control
- Admin-only registration interface
- API endpoint authentication
- Rate limiting on sensitive operations
- Audit logging for all Signal operations

### Compliance
- Signal's Terms of Service compliance
- Data retention policies
- Privacy considerations for phone numbers
- User consent for Signal messaging

## Monitoring & Maintenance

### Health Checks
```typescript
interface SignalHealthCheck {
  containerStatus: 'running' | 'stopped' | 'error';
  apiResponseTime: number;
  registrationStatus: 'registered' | 'unregistered' | 'expired';
  lastMessageSent?: Date;
  messagesSentToday: number;
}
```

### Monitoring Dashboard
- Signal CLI container status
- API response times
- Message delivery success rates
- Registration status
- Error rate tracking

### Maintenance Tasks
- Regular Signal CLI updates
- Message history cleanup
- Performance optimization
- Security patch management

## Migration Strategy

### Gradual Migration Approach
1. **Parallel Operation**
   - Both Matrix bridge and Signal CLI active
   - Feature flag controls which service is used
   - A/B testing for reliability comparison

2. **Selective Migration**
   - Phone verification migrates to Signal CLI
   - Matrix bridge maintained for other functions
   - User preferences for message routing

3. **Complete Migration**
   - Full Signal operations via CLI
   - Matrix bridge deprecated for Signal functions
   - Cleanup of unused Matrix bridge code

### Rollback Plan
- Immediate fallback to Matrix bridge
- Configuration toggle in admin interface
- Data preservation during transitions
- Emergency procedures documentation

## Success Metrics

### Performance Targets
- Message delivery time: < 5 seconds
- Registration success rate: > 95%
- API response time: < 2 seconds
- Container startup time: < 30 seconds

### Reliability Metrics
- Service uptime: > 99.5%
- Message delivery success rate: > 98%
- Registration completion rate: > 90%
- Zero data loss during migration

### User Experience
- Simplified admin configuration
- Clear status indicators
- Intuitive registration process
- Helpful error messages

## Risk Assessment

### Technical Risks
- **Signal CLI breaking changes**: Pin versions, test updates
- **Docker dependency issues**: Health checks, restart policies
- **API rate limiting**: Implement backoff strategies
- **Network connectivity**: Failover mechanisms

### Business Risks
- **Signal Terms of Service**: Regular compliance review
- **User privacy concerns**: Clear consent mechanisms
- **Operational complexity**: Comprehensive documentation
- **Migration disruption**: Careful rollout planning

### Mitigation Strategies
- Comprehensive testing environments
- Feature flags for quick rollbacks
- Detailed monitoring and alerting
- Regular backup and recovery procedures

## Future Enhancements

### Advanced Features
- Group messaging support
- Rich media attachments
- Message history and search
- Automated response capabilities

### Integration Possibilities
- Webhook support for external services
- Multi-phone number management
- Advanced analytics and reporting
- Custom bot commands and responses

## Conclusion

This plan provides a comprehensive approach to integrating Signal CLI as a direct dependency, replacing Matrix-Signal bridge functions while maintaining the benefits of Matrix integration for community features. The phased approach ensures minimal disruption while providing improved reliability and performance.

**Next Steps:**
1. Review and approve implementation plan
2. Set up development environment with Docker
3. Begin Phase 1 infrastructure setup
4. Establish testing and monitoring frameworks

---

*Created: August 16, 2025*  
*Last Updated: August 16, 2025*