'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserCredentialDisplay } from '@/components/ui/user-credentials';
import { SearchableMatrixUserSelect } from '@/components/ui/searchable-matrix-user-select';
import { ArrowLeft, UserPlus, Save, Settings, Building2, Hash, Users, FileText, Copy, Shuffle, Home, RefreshCw, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { PasswordStrength } from '@/components/ui/password-strength';

interface CreatedUserCredentials {
  username: string;
  password: string;
  resetLink?: string;
  ssoUserId?: string;
}

// Matrix user interface
interface MatrixUser {
  user_id: string;
  display_name: string;
  avatar_url?: string;
  is_signal_user?: boolean;
}

// Random words for username generation (from legacy implementation)
const randomWords = [
  'alpha', 'beta', 'gamma', 'delta', 'omega', 'spark', 'flame', 'frost', 'storm', 'wave',
  'rock', 'star', 'moon', 'sun', 'cloud', 'swift', 'bright', 'dark', 'light', 'shadow',
  'fire', 'water', 'earth', 'wind', 'thunder', 'lightning', 'crimson', 'golden', 'silver',
  'azure', 'emerald', 'ruby', 'diamond', 'crystal', 'steel', 'iron', 'copper', 'bronze'
];

export default function CreateUserPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('sso');
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    firstName: '',
    lastName: '',
    password: '',
    confirmPassword: '',
    phoneNumber: '',
    organization: '',
    interests: '',
    invitedBy: '',
    signalUsername: '',
    linkedinUsername: '',
    introduction: '',
    isActive: true,
    isAdmin: false,
    isModerator: false,
    autoGenerateUsername: true,
    sendWelcomeEmail: true,
    createDiscoursePost: true,
    sendMatrixWelcome: true,
    addToRecommendedRooms: true,
    skipIndocRemoval: false,
    matrixUserId: '', // Add Matrix user selection
  });
  
  // Text parser data
  const [parseData, setParseData] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdUser, setCreatedUser] = useState<{
    credentials: CreatedUserCredentials;
    email: string;
  } | null>(null);

  // Matrix user state - directly use query data, no duplicate state
  const [selectedMatrixUser, setSelectedMatrixUser] = useState<MatrixUser | null>(null);

  // Matrix user queries
  const { data: matrixUsers = [], isLoading: matrixUsersLoading, refetch: refetchMatrixUsers } = trpc.matrix.getUsers.useQuery({
    includeSignalUsers: true,
    includeRegularUsers: true,
  });

  const syncMatrixUsers = trpc.matrix.syncMatrixUsers.useMutation({
    onSuccess: () => {
      toast.success('Matrix users sync initiated');
      refetchMatrixUsers();
    },
    onError: (error) => {
      toast.error('Failed to sync Matrix users: ' + error.message);
    },
  });

  // Handle Matrix user selection
  const handleMatrixUserSelect = (userId: string) => {
    const user = matrixUsers.find(u => u.user_id === userId);
    setSelectedMatrixUser(user || null);
    setFormData(prev => ({ ...prev, matrixUserId: userId }));
  };

  // Smart username generation
  const generateUsername = (firstName: string, email: string): string => {
    let baseName = '';
    
    if (firstName.trim()) {
      baseName = firstName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    } else if (email.trim()) {
      // Use part before @ from email if no first name
      const emailPrefix = email.split('@')[0];
      baseName = emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    
    if (!baseName) {
      const randomSuffix = Math.floor(Math.random() * 900) + 100;
      return `user-${randomSuffix}`;
    }
    
    const randomWord = randomWords[Math.floor(Math.random() * randomWords.length)];
    const randomSuffix = Math.floor(Math.random() * 100);
    
    return `${baseName}-${randomWord}${randomSuffix}`;
  };

  // Auto-generate username when first name or email changes
  useEffect(() => {
    if (formData.autoGenerateUsername) {
      const newUsername = generateUsername(formData.firstName, formData.email);
      setFormData(prev => ({ ...prev, username: newUsername }));
    }
  }, [formData.firstName, formData.email, formData.autoGenerateUsername]);

  // Parse text data function - Based on legacy Streamlit logic
  const parseTextData = () => {
    if (!parseData.trim()) {
      toast.error('Please enter some data to parse');
      return;
    }

    const lines = parseData.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const updatedFormData = { ...formData };

    // Reset fields to avoid confusion
    updatedFormData.firstName = '';
    updatedFormData.lastName = '';
    updatedFormData.email = '';
    updatedFormData.organization = '';
    updatedFormData.interests = '';
    updatedFormData.invitedBy = '';
    updatedFormData.signalUsername = '';
    updatedFormData.linkedinUsername = '';
    updatedFormData.introduction = '';

    // Check if this is numbered format (1., 2., 3., etc.)
    const numberedPattern = /^\d+[\.\-\)\s]/;
    const isNumberedFormat = lines.length >= 3 && lines.slice(0, 3).every(line => numberedPattern.test(line));

    if (isNumberedFormat) {
      console.log('Detected numbered format, using position-based parsing');
      
      // Position-based parsing for numbered format (like Streamlit)
      lines.forEach((line, index) => {
        // Remove number prefix with enhanced regex
        const content = line.replace(/^\d+[\.\:\-\)\(\]\[\}\{_\s\@]*\s*/, '').trim();
        
        if (index === 0) {  // Line 1: Name
          const nameParts = content.split(' ');
          if (nameParts.length > 0) {
            updatedFormData.firstName = nameParts[0];
            if (nameParts.length > 1) {
              updatedFormData.lastName = nameParts.slice(1).join(' ');
            }
          }
          console.log(`Parsed name: ${updatedFormData.firstName} ${updatedFormData.lastName}`);
          
        } else if (index === 1) {  // Line 2: Organization
          updatedFormData.organization = content;
          console.log(`Parsed organization: ${content}`);
          
        } else if (index === 2) {  // Line 3: Invited by
          updatedFormData.invitedBy = content;
          console.log(`Parsed invited by: ${content}`);
          
        } else if (index === 3) {  // Line 4: Email
          if (content.includes('@')) {
            updatedFormData.email = content;
            console.log(`Parsed email: ${content}`);
          }
          
        } else if (index === 4) {  // Line 5: Interests
          updatedFormData.interests = content;
          console.log(`Parsed interests: ${content}`);
          
        } else if (index === 5) {  // Line 6: LinkedIn Username
          updatedFormData.linkedinUsername = content;
          console.log(`Parsed LinkedIn username: ${content}`);
        }
      });
      
    } else {
      console.log('Using content-based parsing for non-numbered format');
      
      // Fallback to content-based parsing for non-numbered format
      lines.forEach((line, index) => {
        const cleanLine = line.trim();
        
        // Email detection
        if (cleanLine.includes('@') && cleanLine.includes('.')) {
          updatedFormData.email = cleanLine;
          return;
        }

        // Social media usernames
        if (cleanLine.startsWith('@')) {
          if (cleanLine.toLowerCase().includes('signal')) {
            updatedFormData.signalUsername = cleanLine;
          } else {
            updatedFormData.linkedinUsername = cleanLine.replace('@', '');
          }
          return;
        }

        // Name detection - first line with space likely full name
        if (index === 0 && cleanLine.includes(' ')) {
          const nameParts = cleanLine.split(' ');
          updatedFormData.firstName = nameParts[0];
          updatedFormData.lastName = nameParts.slice(1).join(' ');
          return;
        }

        // Organization detection - look for organizational keywords
        const orgKeywords = [
          'corp', 'inc', 'ltd', 'llc', 'company', 'corporation', 'incorporated',
          'agency', 'department', 'bureau', 'office', 'administration', 'service',
          'investigations', 'security', 'intelligence', 'enforcement', 'defense',
          'homeland', 'federal', 'national', 'government', 'ministry', 'commission',
          'university', 'college', 'institute', 'foundation', 'organization',
          'association', 'society', 'group', 'technologies', 'systems', 'solutions'
        ];
        
        const containsOrgKeyword = orgKeywords.some(keyword => 
          cleanLine.toLowerCase().includes(keyword)
        );
        
        if (containsOrgKeyword) {
          updatedFormData.organization = cleanLine;
          return;
        }

        // Invited by detection - look for informal language patterns
        const invitedByKeywords = [
          'threw', 'link', 'know', 'knows', 'said', 'told', 'mentioned',
          'referred', 'invite', 'invited', 'recommend', 'suggested',
          'contact', 'reach', 'asked', 'enough', 'fletch', 'delgado'
        ];
        
        const containsInvitedByKeyword = invitedByKeywords.some(keyword => 
          cleanLine.toLowerCase().includes(keyword)
        );
        
        if (containsInvitedByKeyword) {
          updatedFormData.invitedBy = cleanLine;
          return;
        }

        // Interests detection - long descriptive text with tech keywords
        const interestKeywords = [
          'interesting', 'interested', 'tech', 'technology', 'security', 'ai',
          'development', 'programming', 'python', 'javascript', 'systems',
          'ttps', 'professional', 'application', 'exposure', 'chat', 'chats',
          'current', 'staying', 'unmanned', 'acquisition'
        ];
        
        const containsInterestKeyword = interestKeywords.some(keyword => 
          cleanLine.toLowerCase().includes(keyword)
        );
        
        if (cleanLine.length > 50 && containsInterestKeyword) {
          updatedFormData.interests = cleanLine;
          return;
        }

        // Fallback positional logic for remaining fields
        if (index === 1 && !updatedFormData.organization) {
          updatedFormData.organization = cleanLine;
        } else if (index === 2 && !updatedFormData.invitedBy) {
          updatedFormData.invitedBy = cleanLine;
        } else if (!updatedFormData.interests && cleanLine.length > 30) {
          updatedFormData.interests = cleanLine;
        }
      });
    }

    setFormData(updatedFormData);
    toast.success('Data parsed successfully');
  };

  const clearParseData = () => {
    setParseData('');
    
    // Reset all form fields to initial state
    setFormData({
      username: '',
      email: '',
      firstName: '',
      lastName: '',
      password: '',
      confirmPassword: '',
      phoneNumber: '',
      organization: '',
      interests: '',
      invitedBy: '',
      signalUsername: '',
      linkedinUsername: '',
      introduction: '',
      isActive: true,
      isAdmin: false,
      isModerator: false,
      autoGenerateUsername: true,
      sendWelcomeEmail: true,
      createDiscoursePost: true,
      sendMatrixWelcome: true,
      addToRecommendedRooms: true,
      skipIndocRemoval: false,
      matrixUserId: '',
    });
    
    // Clear any form errors
    setErrors({});
    
    toast.success('Parse data and all fields cleared');
  };

  const createUserMutation = trpc.user.createUser.useMutation({
    onSuccess: () => {
      toast.success('Local user created successfully');
      router.push('/users');
    },
    onError: (error: { message: string }) => {
      setErrors({ general: error.message });
      toast.error('Failed to create user');
    },
  });

  const createSSOUserMutation = trpc.user.createSSOUser.useMutation({
    onSuccess: (data) => {
      toast.success('SSO user created successfully');
      setCreatedUser({
        credentials: {
          username: data.credentials?.username || data.username || '',
          password: data.credentials?.password || data.tempPassword || '',
          resetLink: data.credentials?.resetLink || data.passwordResetLink,
          ssoUserId: data.ssoUserId,
        },
        email: formData.email,
      });
    },
    onError: (error: { message: string }) => {
      setErrors({ general: error.message });
      toast.error('Failed to create SSO user');
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrors({});

    // Enhanced validation - only email is required
    const newErrors: Record<string, string> = {};
    
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    // For local users, validate username and password
    if (activeTab === 'local') {
      if (!formData.username.trim()) {
        newErrors.username = 'Username is required';
      }
      
      if (formData.password && formData.password.length < 6) {
        newErrors.password = 'Password must be at least 6 characters';
      }
      
      if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
    }

    // For SSO users, validate username if not auto-generating
    if (activeTab === 'sso' && !formData.autoGenerateUsername && !formData.username.trim()) {
      newErrors.username = 'Username is required when not auto-generating';
    }

    // Validate optional fields format
    if (formData.phoneNumber && !/^\+?[\d\s\-\(\)]+$/.test(formData.phoneNumber)) {
      newErrors.phoneNumber = 'Please enter a valid phone number';
    }

    if (formData.signalUsername && !formData.signalUsername.startsWith('@')) {
      newErrors.signalUsername = 'Signal username should start with @';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setIsSubmitting(false);
      return;
    }

    try {
      if (activeTab === 'local') {
        await createUserMutation.mutateAsync({
          username: formData.username.trim(),
          email: formData.email.trim(),
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          password: formData.password || undefined,
          isActive: formData.isActive,
          isAdmin: formData.isAdmin,
          isModerator: formData.isModerator,
          // Add new fields
          organization: formData.organization.trim() || undefined,
          interests: formData.interests.trim() || undefined,
          invitedBy: formData.invitedBy.trim() || undefined,
          signalUsername: formData.signalUsername.trim() || undefined,
          linkedinUsername: formData.linkedinUsername.trim() || undefined,
          introduction: formData.introduction.trim() || undefined,
          phoneNumber: formData.phoneNumber.trim() || undefined,
        });
      } else {
        await createSSOUserMutation.mutateAsync({
          email: formData.email.trim(),
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          username: formData.autoGenerateUsername ? undefined : formData.username.trim(),
          phoneNumber: formData.phoneNumber.trim() || undefined,
          autoGenerateUsername: formData.autoGenerateUsername,
          sendWelcomeEmail: formData.sendWelcomeEmail,
          // Add new fields
          organization: formData.organization.trim() || undefined,
          interests: formData.interests.trim() || undefined,
          invitedBy: formData.invitedBy.trim() || undefined,
          signalUsername: formData.signalUsername.trim() || undefined,
          linkedinUsername: formData.linkedinUsername.trim() || undefined,
          introduction: formData.introduction.trim() || undefined,
          createDiscoursePost: formData.createDiscoursePost,
          sendMatrixWelcome: formData.sendMatrixWelcome,
          addToRecommendedRooms: formData.addToRecommendedRooms,
          skipIndocRemoval: formData.skipIndocRemoval,
        });
      }
    } catch {
      // Error handled in mutation
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
    
    // Real-time validation for string fields
    if (typeof value === 'string') {
      const newErrors = { ...errors };
      
      // Validate field in real-time
      switch (field) {
        case 'email':
          if (!value.trim()) {
            newErrors.email = 'Email is required';
          } else if (!/\S+@\S+\.\S+/.test(value)) {
            newErrors.email = 'Please enter a valid email address';
          } else {
            delete newErrors.email;
          }
          break;
          
        case 'username':
          if (activeTab === 'local' && !value.trim()) {
            newErrors.username = 'Username is required';
          } else if (activeTab === 'sso' && !formData.autoGenerateUsername && !value.trim()) {
            newErrors.username = 'Username is required when not auto-generating';
          } else if (value.length > 0 && value.length < 3) {
            newErrors.username = 'Username must be at least 3 characters';
          } else if (value.length > 0 && !/^[a-zA-Z0-9_-]+$/.test(value)) {
            newErrors.username = 'Username can only contain letters, numbers, underscores, and hyphens';
          } else {
            delete newErrors.username;
          }
          break;
          
        case 'password':
          if (activeTab === 'local' && value && value.length < 6) {
            newErrors.password = 'Password must be at least 6 characters';
          } else if (activeTab === 'local' && value && !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(value)) {
            newErrors.password = 'Password must contain at least one uppercase letter, one lowercase letter, and one number';
          } else {
            delete newErrors.password;
          }
          // Also validate confirm password if it exists
          if (formData.confirmPassword && value !== formData.confirmPassword) {
            newErrors.confirmPassword = 'Passwords do not match';
          } else if (formData.confirmPassword) {
            delete newErrors.confirmPassword;
          }
          break;
          
        case 'confirmPassword':
          if (activeTab === 'local' && value !== formData.password) {
            newErrors.confirmPassword = 'Passwords do not match';
          } else {
            delete newErrors.confirmPassword;
          }
          break;
          
        case 'phoneNumber':
          if (value && !/^\+?[\d\s\-\(\)]+$/.test(value)) {
            newErrors.phoneNumber = 'Please enter a valid phone number with country code (e.g., +1234567890)';
          } else if (value && value.length > 0 && value.length < 10) {
            newErrors.phoneNumber = 'Phone number seems too short';
          } else {
            delete newErrors.phoneNumber;
          }
          break;
          
        case 'signalUsername':
          if (value && !value.startsWith('@')) {
            newErrors.signalUsername = 'Signal username should start with @';
          } else if (value && value.length > 1 && value.length < 4) {
            newErrors.signalUsername = 'Signal username must be at least 3 characters after @';
          } else {
            delete newErrors.signalUsername;
          }
          break;
          
        case 'firstName':
        case 'lastName':
          if (value && value.length > 0 && value.length < 2) {
            newErrors[field] = `${field === 'firstName' ? 'First' : 'Last'} name must be at least 2 characters`;
          } else if (value && !/^[a-zA-Z\s'-]+$/.test(value)) {
            newErrors[field] = `${field === 'firstName' ? 'First' : 'Last'} name can only contain letters, spaces, apostrophes, and hyphens`;
          } else {
            delete newErrors[field];
          }
          break;
          
        default:
          // Clear error for other fields when user starts typing
          if (errors[field]) {
            delete newErrors[field];
          }
          break;
      }
      
      setErrors(newErrors);
      
      // Auto-generate username for SSO if enabled
      if ((field === 'firstName' || field === 'lastName') && activeTab === 'sso' && formData.autoGenerateUsername) {
        const firstName = field === 'firstName' ? value : formData.firstName;
        const lastName = field === 'lastName' ? value : formData.lastName;
        if (firstName && lastName) {
          const generatedUsername = `${firstName.toLowerCase()}${lastName.toLowerCase()}`.replace(/[^a-zA-Z0-9]/g, '');
          setFormData(prev => ({ 
            ...prev, 
            username: generatedUsername
          }));
        }
      }
    } else {
      // For boolean fields, just clear any existing error
      if (errors[field]) {
        setErrors(prev => ({
          ...prev,
          [field]: '',
        }));
      }
    }
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Please sign in to access this page</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!session.user.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You need admin privileges to create users</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Show credential display if user was created
  if (createdUser) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">User Created Successfully</h1>
                <p className="text-sm text-gray-600">
                  SSO user account has been created and configured
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => router.push('/users')}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Users
              </Button>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <UserCredentialDisplay
            credentials={createdUser.credentials}
            userEmail={createdUser.email}
            onClose={() => setCreatedUser(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 
                className="text-2xl font-bold text-gray-900 cursor-pointer hover:text-blue-600 transition-colors"
                onClick={() => router.push('/')}
                title="Return to Dashboard"
              >
                Create New User
              </h1>
              <p className="text-sm text-gray-600">
                Add a new member to your community
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => router.push('/')}
                className="flex items-center gap-2"
              >
                <Home className="w-4 h-4" />
                Dashboard
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push('/users')}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Users
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              User Information
            </CardTitle>
            <CardDescription>
              Choose how to create the new user account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="sso" className="flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  SSO User (Recommended)
                </TabsTrigger>
                <TabsTrigger value="local" className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4" />
                  Local User
                </TabsTrigger>
              </TabsList>

              <TabsContent value="sso" className="space-y-6 mt-6">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>SSO User:</strong> Creates user in Authentik SSO with auto-generated credentials. 
                    Provides full community access and integration with Matrix/Signal bridge.
                  </p>
                </div>

                {/* Text Parser Section */}
                <Card className="border-green-200 dark:border-green-800">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-300">
                      <FileText className="w-5 h-5" />
                      Parse Text Data
                    </CardTitle>
                    <CardDescription>
                      Enter multiple lines of information to automatically populate user fields
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="parseData">Data to Parse</Label>
                      <Textarea
                        id="parseData"
                        value={parseData}
                        onChange={(e) => setParseData(e.target.value)}
                        placeholder="1. John Doe&#10;2. ACME Corporation&#10;3. Jane Smith&#10;4. john.doe@example.com&#10;5. AI, Python, Security&#10;6. @johndoe"
                        rows={6}
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-gray-600">
                        Enter multiple lines of information. The system will automatically parse names, emails, organizations, interests, and usernames.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={parseTextData}
                        className="flex items-center gap-2"
                        disabled={!parseData.trim()}
                      >
                        <Shuffle className="w-4 h-4" />
                        Parse Data
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={clearParseData}
                        disabled={!parseData.trim()}
                        className="flex items-center gap-2"
                      >
                        <Copy className="w-4 h-4" />
                        Clear
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <form onSubmit={handleSubmit} className="space-y-6">
                  {errors.general && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                      <p className="text-sm text-red-600">{errors.general}</p>
                    </div>
                  )}

                  {/* Basic Information - Combined and Optimized for Desktop */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <UserPlus className="w-5 h-5" />
                        Basic Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {/* Email field - full width */}
                      <div className="space-y-2">
                        <Label htmlFor="email">Email Address *</Label>
                        <Input
                          id="email"
                          type="email"
                          value={formData.email}
                          onChange={(e) => handleInputChange('email', e.target.value)}
                          placeholder="john@example.com"
                          className={errors.email ? 'border-red-500' : ''}
                        />
                        {errors.email && (
                          <p className="text-sm text-red-500">{errors.email}</p>
                        )}
                      </div>

                      {/* First Name, Last Name, and Phone Number - 3 columns on desktop, 2 on mobile */}
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="firstName">First Name</Label>
                          <Input
                            id="firstName"
                            type="text"
                            value={formData.firstName}
                            onChange={(e) => handleInputChange('firstName', e.target.value)}
                            placeholder="John"
                            className={errors.firstName ? 'border-red-500' : ''}
                          />
                          {errors.firstName && (
                            <p className="text-sm text-red-500">{errors.firstName}</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="lastName">Last Name</Label>
                          <Input
                            id="lastName"
                            type="text"
                            value={formData.lastName}
                            onChange={(e) => handleInputChange('lastName', e.target.value)}
                            placeholder="Doe"
                            className={errors.lastName ? 'border-red-500' : ''}
                          />
                          {errors.lastName && (
                            <p className="text-sm text-red-500">{errors.lastName}</p>
                          )}
                        </div>

                        <div className="space-y-2 col-span-2 lg:col-span-1">
                          <Label htmlFor="phoneNumber">Phone Number (Optional)</Label>
                          <Input
                            id="phoneNumber"
                            type="tel"
                            value={formData.phoneNumber}
                            onChange={(e) => handleInputChange('phoneNumber', e.target.value)}
                            placeholder="+1234567890"
                            className={errors.phoneNumber ? 'border-red-500' : ''}
                          />
                          <p className="text-xs text-gray-600">
                            For Matrix/Signal bridge linking (include country code)
                          </p>
                          {errors.phoneNumber && (
                            <p className="text-sm text-red-500">{errors.phoneNumber}</p>
                          )}
                        </div>
                      </div>

                      {/* Organization, LinkedIn, and Signal Username - 3 columns on desktop, 2 on mobile */}
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="organization">Organization</Label>
                          <Input
                            id="organization"
                            type="text"
                            value={formData.organization}
                            onChange={(e) => handleInputChange('organization', e.target.value)}
                            placeholder="Company or organization name"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="linkedinUsername">LinkedIn Username</Label>
                          <Input
                            id="linkedinUsername"
                            type="text"
                            value={formData.linkedinUsername}
                            onChange={(e) => handleInputChange('linkedinUsername', e.target.value)}
                            placeholder="username"
                          />
                        </div>

                        <div className="space-y-2 col-span-2 lg:col-span-1">
                          <Label htmlFor="signalUsername">Signal Username</Label>
                          <Input
                            id="signalUsername"
                            type="text"
                            value={formData.signalUsername}
                            onChange={(e) => handleInputChange('signalUsername', e.target.value)}
                            placeholder="@username"
                            className={errors.signalUsername ? 'border-red-500' : ''}
                          />
                          {errors.signalUsername && (
                            <p className="text-sm text-red-500">{errors.signalUsername}</p>
                          )}
                        </div>
                      </div>

                      {/* Invited By - full width */}
                      <div className="space-y-2">
                        <Label htmlFor="invitedBy">Invited By</Label>
                        <Input
                          id="invitedBy"
                          type="text"
                          value={formData.invitedBy}
                          onChange={(e) => handleInputChange('invitedBy', e.target.value)}
                          placeholder="Username or name of person who invited them"
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Username Configuration */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Hash className="w-5 h-5" />
                        Username Configuration
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="autoGenerateUsername"
                          checked={formData.autoGenerateUsername}
                          onCheckedChange={(checked) => handleInputChange('autoGenerateUsername', checked === true)}
                        />
                        <Label htmlFor="autoGenerateUsername" className="text-sm">
                          Auto-generate username (recommended)
                        </Label>
                      </div>

                      {!formData.autoGenerateUsername && (
                        <div className="space-y-2">
                          <Label htmlFor="username">Username</Label>
                          <Input
                            id="username"
                            type="text"
                            value={formData.username}
                            onChange={(e) => handleInputChange('username', e.target.value)}
                            placeholder="johndoe"
                            className={errors.username ? 'border-red-500' : ''}
                          />
                          {errors.username && (
                            <p className="text-sm text-red-500">{errors.username}</p>
                          )}
                        </div>
                      )}

                      {formData.autoGenerateUsername && formData.username && (
                        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Generated username: <span className="font-mono font-medium">{formData.username}</span>
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Additional Information */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Building2 className="w-5 h-5" />
                        Additional Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="interests">Interests</Label>
                        <Textarea
                          id="interests"
                          value={formData.interests}
                          onChange={(e) => handleInputChange('interests', e.target.value)}
                          placeholder="AI, Security, Development, etc."
                          rows={4}
                        />
                        <p className="text-xs text-gray-600">
                          Comma-separated list of interests or areas of expertise
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="introduction">Introduction</Label>
                        <Textarea
                          id="introduction"
                          value={formData.introduction}
                          onChange={(e) => handleInputChange('introduction', e.target.value)}
                          placeholder="A few sentences about the new user..."
                          rows={3}
                        />
                        <p className="text-xs text-gray-600">
                          Brief introduction for the new user. Organization and interests will be added automatically.
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Matrix User Connection */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <MessageSquare className="w-5 h-5" />
                        Connect with Matrix User
                      </CardTitle>
                      <CardDescription>
                        Select a Matrix user to connect with this new account
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Sync Matrix Users Button */}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => syncMatrixUsers.mutate()}
                        disabled={syncMatrixUsers.isPending}
                        className="w-full"
                      >
                        {syncMatrixUsers.isPending ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                            Syncing Matrix Users...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Sync Matrix User Cache
                          </>
                        )}
                      </Button>

                      {/* Matrix User Selection */}
                      <div className="space-y-2">
                        <Label htmlFor="matrixUser">Select Matrix User</Label>
                        {matrixUsersLoading ? (
                          <div className="flex items-center justify-center p-4 border border-gray-200 rounded-md">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-600"></div>
                            <span className="ml-2 text-sm text-gray-600">Loading Matrix users...</span>
                          </div>
                        ) : (
                          <SearchableMatrixUserSelect
                            users={matrixUsers}
                            value={formData.matrixUserId}
                            onValueChange={handleMatrixUserSelect}
                            placeholder="Search and select a Matrix user..."
                            emptyText="No Matrix users found. Try syncing the Matrix user cache first."
                            className="w-full"
                          />
                        )}
                      </div>

                      {/* Selected Matrix User Display */}
                      {selectedMatrixUser && (
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800">
                          <p className="text-sm text-blue-800 dark:text-blue-200">
                            <strong>Selected Matrix User:</strong> {selectedMatrixUser.display_name}
                          </p>
                          <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">
                            {selectedMatrixUser.user_id}
                          </p>
                        </div>
                      )}

                      {/* Information about Matrix user selection */}
                      <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          Connecting with a Matrix user allows for automatic welcome messages and room invitations.
                          The welcome message will be sent to the selected Matrix user if enabled in Integration Options.
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Integration Options */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Settings className="w-5 h-5" />
                        Integration Options
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-3">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="sendWelcomeEmail"
                            checked={formData.sendWelcomeEmail}
                            onCheckedChange={(checked) => handleInputChange('sendWelcomeEmail', checked === true)}
                          />
                          <Label htmlFor="sendWelcomeEmail" className="text-sm">
                            Send welcome email to user
                          </Label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="createDiscoursePost"
                            checked={formData.createDiscoursePost}
                            onCheckedChange={(checked) => handleInputChange('createDiscoursePost', checked === true)}
                          />
                          <Label htmlFor="createDiscoursePost" className="text-sm">
                            Create Discourse introduction post
                          </Label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="sendMatrixWelcome"
                            checked={formData.sendMatrixWelcome}
                            onCheckedChange={(checked) => handleInputChange('sendMatrixWelcome', checked === true)}
                          />
                          <Label htmlFor="sendMatrixWelcome" className="text-sm">
                            Send welcome message to Matrix user
                          </Label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="addToRecommendedRooms"
                            checked={formData.addToRecommendedRooms}
                            onCheckedChange={(checked) => handleInputChange('addToRecommendedRooms', checked === true)}
                          />
                          <Label htmlFor="addToRecommendedRooms" className="text-sm">
                            Add to recommended Matrix rooms
                          </Label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="skipIndocRemoval"
                            checked={formData.skipIndocRemoval}
                            onCheckedChange={(checked) => handleInputChange('skipIndocRemoval', checked === true)}
                          />
                          <Label htmlFor="skipIndocRemoval" className="text-sm">
                            Skip INDOC room removal
                          </Label>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="flex justify-end space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.push('/users')}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex items-center gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Creating SSO User...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Create SSO User
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </TabsContent>

              <TabsContent value="local" className="space-y-6 mt-6">
                <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                  <p className="text-sm text-orange-800 dark:text-orange-200">
                    <strong>Local User:</strong> Creates user only in local database. 
                    Limited to dashboard access without SSO integration.
                  </p>
                </div>

                {/* Text Parser Section */}
                <Card className="border-green-200 dark:border-green-800">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-300">
                      <FileText className="w-5 h-5" />
                      Parse Text Data
                    </CardTitle>
                    <CardDescription>
                      Enter multiple lines of information to automatically populate user fields
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="parseData">Data to Parse</Label>
                      <Textarea
                        id="parseData"
                        value={parseData}
                        onChange={(e) => setParseData(e.target.value)}
                        placeholder="1. John Doe&#10;2. ACME Corporation&#10;3. Jane Smith&#10;4. john.doe@example.com&#10;5. AI, Python, Security&#10;6. @johndoe"
                        rows={6}
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-gray-600">
                        Enter multiple lines of information. The system will automatically parse names, emails, organizations, interests, and usernames.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={parseTextData}
                        className="flex items-center gap-2"
                        disabled={!parseData.trim()}
                      >
                        <Shuffle className="w-4 h-4" />
                        Parse Data
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={clearParseData}
                        disabled={!parseData.trim()}
                        className="flex items-center gap-2"
                      >
                        <Copy className="w-4 h-4" />
                        Clear
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <form onSubmit={handleSubmit} className="space-y-6">
                  {errors.general && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                      <p className="text-sm text-red-600">{errors.general}</p>
                    </div>
                  )}

                  {/* Basic Information - Combined and Optimized for Desktop */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <UserPlus className="w-5 h-5" />
                        Basic Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {/* Email field - full width */}
                      <div className="space-y-2">
                        <Label htmlFor="email">Email Address *</Label>
                        <Input
                          id="email"
                          type="email"
                          value={formData.email}
                          onChange={(e) => handleInputChange('email', e.target.value)}
                          placeholder="john@example.com"
                          className={errors.email ? 'border-red-500' : ''}
                        />
                        {errors.email && (
                          <p className="text-sm text-red-500">{errors.email}</p>
                        )}
                      </div>

                      {/* First Name, Last Name, and Phone Number - 3 columns on desktop, 2 on mobile */}
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="firstName">First Name</Label>
                          <Input
                            id="firstName"
                            type="text"
                            value={formData.firstName}
                            onChange={(e) => handleInputChange('firstName', e.target.value)}
                            placeholder="John"
                            className={errors.firstName ? 'border-red-500' : ''}
                          />
                          {errors.firstName && (
                            <p className="text-sm text-red-500">{errors.firstName}</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="lastName">Last Name</Label>
                          <Input
                            id="lastName"
                            type="text"
                            value={formData.lastName}
                            onChange={(e) => handleInputChange('lastName', e.target.value)}
                            placeholder="Doe"
                            className={errors.lastName ? 'border-red-500' : ''}
                          />
                          {errors.lastName && (
                            <p className="text-sm text-red-500">{errors.lastName}</p>
                          )}
                        </div>

                        <div className="space-y-2 col-span-2 lg:col-span-1">
                          <Label htmlFor="phoneNumber">Phone Number (Optional)</Label>
                          <Input
                            id="phoneNumber"
                            type="tel"
                            value={formData.phoneNumber}
                            onChange={(e) => handleInputChange('phoneNumber', e.target.value)}
                            placeholder="+1234567890"
                            className={errors.phoneNumber ? 'border-red-500' : ''}
                          />
                          <p className="text-xs text-gray-600">
                            Include country code for international numbers
                          </p>
                          {errors.phoneNumber && (
                            <p className="text-sm text-red-500">{errors.phoneNumber}</p>
                          )}
                        </div>
                      </div>

                      {/* Organization, LinkedIn, and Signal Username - 3 columns on desktop, 2 on mobile */}
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="organization">Organization</Label>
                          <Input
                            id="organization"
                            type="text"
                            value={formData.organization}
                            onChange={(e) => handleInputChange('organization', e.target.value)}
                            placeholder="Company or organization name"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="linkedinUsername">LinkedIn Username</Label>
                          <Input
                            id="linkedinUsername"
                            type="text"
                            value={formData.linkedinUsername}
                            onChange={(e) => handleInputChange('linkedinUsername', e.target.value)}
                            placeholder="username"
                          />
                        </div>

                        <div className="space-y-2 col-span-2 lg:col-span-1">
                          <Label htmlFor="signalUsername">Signal Username</Label>
                          <Input
                            id="signalUsername"
                            type="text"
                            value={formData.signalUsername}
                            onChange={(e) => handleInputChange('signalUsername', e.target.value)}
                            placeholder="@username"
                            className={errors.signalUsername ? 'border-red-500' : ''}
                          />
                          {errors.signalUsername && (
                            <p className="text-sm text-red-500">{errors.signalUsername}</p>
                          )}
                        </div>
                      </div>

                      {/* Invited By - full width */}
                      <div className="space-y-2">
                        <Label htmlFor="invitedBy">Invited By</Label>
                        <Input
                          id="invitedBy"
                          type="text"
                          value={formData.invitedBy}
                          onChange={(e) => handleInputChange('invitedBy', e.target.value)}
                          placeholder="Username or name of person who invited them"
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Username and Password */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Hash className="w-5 h-5" />
                        Username and Password
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="username">Username *</Label>
                        <Input
                          id="username"
                          type="text"
                          value={formData.username}
                          onChange={(e) => handleInputChange('username', e.target.value)}
                          placeholder="johndoe"
                          className={errors.username ? 'border-red-500' : ''}
                        />
                        {errors.username && (
                          <p className="text-sm text-red-500">{errors.username}</p>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="password">Password (Optional)</Label>
                          <Input
                            id="password"
                            type="password"
                            value={formData.password}
                            onChange={(e) => handleInputChange('password', e.target.value)}
                            placeholder="Leave blank for no password"
                            className={errors.password ? 'border-red-500' : ''}
                          />
                          {formData.password && (
                            <PasswordStrength password={formData.password} />
                          )}
                          {errors.password && (
                            <p className="text-sm text-red-500">{errors.password}</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="confirmPassword">Confirm Password</Label>
                          <Input
                            id="confirmPassword"
                            type="password"
                            value={formData.confirmPassword}
                            onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                            placeholder="Confirm password"
                            className={errors.confirmPassword ? 'border-red-500' : ''}
                          />
                          {errors.confirmPassword && (
                            <p className="text-sm text-red-500">{errors.confirmPassword}</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Additional Information */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Building2 className="w-5 h-5" />
                        Additional Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="interests">Interests</Label>
                        <Textarea
                          id="interests"
                          value={formData.interests}
                          onChange={(e) => handleInputChange('interests', e.target.value)}
                          placeholder="AI, Security, Development, etc."
                          rows={4}
                        />
                        <p className="text-xs text-gray-600">
                          Comma-separated list of interests or areas of expertise
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="introduction">Introduction</Label>
                        <Textarea
                          id="introduction"
                          value={formData.introduction}
                          onChange={(e) => handleInputChange('introduction', e.target.value)}
                          placeholder="A few sentences about the new user..."
                          rows={3}
                        />
                        <p className="text-xs text-gray-600">
                          Brief introduction for the new user. Organization and interests will be added automatically.
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* User Permissions */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Users className="w-5 h-5" />
                        User Permissions
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-3">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="isActive"
                            checked={formData.isActive}
                            onCheckedChange={(checked) => handleInputChange('isActive', checked === true)}
                          />
                          <Label htmlFor="isActive" className="text-sm">
                            Active User
                          </Label>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="isModerator"
                            checked={formData.isModerator}
                            onCheckedChange={(checked) => handleInputChange('isModerator', checked === true)}
                          />
                          <Label htmlFor="isModerator" className="text-sm">
                            Moderator
                          </Label>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="isAdmin"
                            checked={formData.isAdmin}
                            onCheckedChange={(checked) => handleInputChange('isAdmin', checked === true)}
                          />
                          <Label htmlFor="isAdmin" className="text-sm">
                            Administrator
                          </Label>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="flex justify-end space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.push('/users')}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex items-center gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Creating...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Create User
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}