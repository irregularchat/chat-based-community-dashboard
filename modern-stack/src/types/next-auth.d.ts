import 'next-auth';

declare module 'next-auth' {
  interface User {
    id: string;
    username?: string;
    isAdmin?: boolean;
    isModerator?: boolean;
    groups?: string[];
    firstName?: string;
    lastName?: string;
    authentikId?: string;
    password?: string;
  }

  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      username?: string;
      isAdmin?: boolean;
      isModerator?: boolean;
      groups?: string[];
      provider?: string;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    username?: string;
    isAdmin?: boolean;
    isModerator?: boolean;
    groups?: string[];
    provider?: string;
  }
} 