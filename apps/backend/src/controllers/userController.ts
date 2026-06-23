import { Response } from 'express';
import * as userService from '../services/userService';
import { asyncHandler } from '../middlewares/errorHandler';
import { registerSchema, loginSchema } from '../validation/schemas';
import { AuthedRequest } from '../middlewares/authMiddleware';

export const registerUser = asyncHandler(async (req, res) => {
  const { email, password } = registerSchema.parse(req.body);
  const result = await userService.registerUser(email, password);
  res.status(201).json(result);
});

export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const result = await userService.loginUser(email, password);
  res.status(200).json(result);
});

/** Returns the currently authenticated user. */
export const getMe = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const user = await userService.getUserById(req.userId!);
  res.status(200).json(user);
});
