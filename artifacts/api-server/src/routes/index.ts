import { Router, type IRouter } from 'express';
import healthRouter from './health';
import storageRouter from './storage';
import presentationsRouter from './presentations';
import quizzesRouter from './quizzes';

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(presentationsRouter);
router.use(quizzesRouter);

export default router;
