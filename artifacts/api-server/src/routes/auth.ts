import { Router, type IRouter, type Request, type Response } from 'express';
import { PRESENTER_PASSWORD } from '../lib/presenterAuth';

const router: IRouter = Router();

/**
 * POST /auth/verify
 *
 * Checks a presenter/admin password against the server-side value without
 * any side effects, so the frontend's password gates can reject a wrong
 * password before ever rendering the admin dashboard.
 */
router.post('/auth/verify', (req: Request, res: Response): void => {
  const password = req.body?.password;
  if (typeof password !== 'string' || password !== PRESENTER_PASSWORD) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }
  res.json({ ok: true });
});

export default router;
