import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../prisma/client';
import { config } from '../config';
import { AppError } from '../middlewares/errorHandler';

const signToken = (userId: string) =>
  jwt.sign({ userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);

const publicUser = (user: { id: string; email: string; createdAt: Date }) => ({
  id: user.id,
  email: user.email,
  createdAt: user.createdAt,
});

export const registerUser = async (email: string, password: string) => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError('Email is already registered', 409);

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { email, password: hashedPassword } });
  return { user: publicUser(user), token: signToken(user.id) };
};

export const loginUser = async (email: string, password: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new AppError('Invalid credentials', 401);

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) throw new AppError('Invalid credentials', 401);

  return { user: publicUser(user), token: signToken(user.id) };
};

export const getUserById = async (id: string) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError('User not found', 404);
  return publicUser(user);
};
