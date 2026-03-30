// -------------------------------------------------------
// Auth Middleware
// -------------------------------------------------------
// Extracts the JWT from the Authorization header,
// verifies it, and attaches the user info to the
// request object. If the token is missing or invalid,
// sends a 401 response.
//
// Usage in routes:
//   router.get('/protected', authenticate, (req, res) => {
//     console.log(req.user.userId); // guaranteed to exist
//   });
// -------------------------------------------------------

import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';

// Extend Express Request type to include user info
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
      };
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = authService.verifyAccessToken(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
