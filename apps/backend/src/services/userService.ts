import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import prisma from '../prisma/client';
import { config } from '../config';
import { AppError } from '../middlewares/errorHandler';

const signToken = (userId: string) =>
  jwt.sign({ userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);

const publicUser = (user: { id: string; email: string; createdAt: Date; walletAddress: string | null }) => ({
  id: user.id,
  email: user.email,
  walletAddress: user.walletAddress,
  createdAt: user.createdAt,
});

/** The exact message a wallet must sign to prove ownership when linking. */
export const walletLinkMessage = (userId: string) => `Pulsar: link wallet to account ${userId}`;

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

/**
 * Link a Solana wallet to the user — but only after verifying they control it,
 * by checking an ed25519 signature over a message bound to this account id.
 */
export const linkWallet = async (userId: string, walletAddress: string, signature: string) => {
  let verified = false;
  try {
    verified = nacl.sign.detached.verify(
      new TextEncoder().encode(walletLinkMessage(userId)),
      bs58.decode(signature),
      bs58.decode(walletAddress),
    );
  } catch {
    verified = false;
  }
  if (!verified) throw new AppError('Wallet signature verification failed', 400);

  const user = await prisma.user.update({ where: { id: userId }, data: { walletAddress } });
  return publicUser(user);
};
