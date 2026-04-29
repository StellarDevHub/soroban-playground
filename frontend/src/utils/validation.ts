// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Email validation
export const validateEmail = (email: string): { isValid: boolean; error?: string } => {
  if (!email) {
    return { isValid: false, error: 'Email is required' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { isValid: false, error: 'Please enter a valid email address' };
  }

  if (email.length > 254) {
    return { isValid: false, error: 'Email address is too long' };
  }

  return { isValid: true };
};

// Stellar address validation
export const validateStellarAddress = (address: string): { isValid: boolean; error?: string } => {
  if (!address) {
    return { isValid: false, error: 'Address is required' };
  }

  // Stellar addresses start with 'G' and are 56 characters long
  if (!address.startsWith('G')) {
    return { isValid: false, error: 'Address must start with G' };
  }

  if (address.length !== 56) {
    return { isValid: false, error: 'Address must be 56 characters long' };
  }

  // Check if all characters are valid (alphanumeric)
  const validChars = /^[ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789]+$/;
  if (!validChars.test(address)) {
    return { isValid: false, error: 'Address contains invalid characters' };
  }

  return { isValid: true };
};

// Plan ID validation
export const validatePlanId = (planId: string): { isValid: boolean; error?: string } => {
  if (!planId) {
    return { isValid: false, error: 'Plan ID is required' };
  }

  if (planId.length < 3) {
    return { isValid: false, error: 'Plan ID must be at least 3 characters long' };
  }

  if (planId.length > 50) {
    return { isValid: false, error: 'Plan ID must be less than 50 characters long' };
  }

  // Allow alphanumeric, hyphens, and underscores
  const validChars = /^[a-zA-Z0-9_-]+$/;
  if (!validChars.test(planId)) {
    return { isValid: false, error: 'Plan ID can only contain letters, numbers, hyphens, and underscores' };
  }

  return { isValid: true };
};

// Plan name validation
export const validatePlanName = (name: string): { isValid: boolean; error?: string } => {
  if (!name) {
    return { isValid: false, error: 'Plan name is required' };
  }

  if (name.length < 2) {
    return { isValid: false, error: 'Plan name must be at least 2 characters long' };
  }

  if (name.length > 100) {
    return { isValid: false, error: 'Plan name must be less than 100 characters long' };
  }

  return { isValid: true };
};

// Price validation
export const validatePrice = (price: number): { isValid: boolean; error?: string } => {
  if (price === null || price === undefined) {
    return { isValid: false, error: 'Price is required' };
  }

  if (typeof price !== 'number' || isNaN(price)) {
    return { isValid: false, error: 'Price must be a valid number' };
  }

  if (price <= 0) {
    return { isValid: false, error: 'Price must be greater than 0' };
  }

  if (price > 1000000) {
    return { isValid: false, error: 'Price must be less than 1,000,000' };
  }

  // Check for reasonable decimal places (max 8 for crypto)
  const decimalPlaces = (price.toString().split('.')[1] || '').length;
  if (decimalPlaces > 8) {
    return { isValid: false, error: 'Price can have at most 8 decimal places' };
  }

  return { isValid: true };
};

// Billing period validation
export const validateBillingPeriod = (period: number): { isValid: boolean; error?: string } => {
  if (period === null || period === undefined) {
    return { isValid: false, error: 'Billing period is required' };
  }

  if (typeof period !== 'number' || isNaN(period)) {
    return { isValid: false, error: 'Billing period must be a valid number' };
  }

  if (period <= 0) {
    return { isValid: false, error: 'Billing period must be greater than 0' };
  }

  if (period < 3600) { // Less than 1 hour
    return { isValid: false, error: 'Billing period must be at least 1 hour (3600 seconds)' };
  }

  if (period > 31536000) { // More than 1 year
    return { isValid: false, error: 'Billing period must be less than 1 year (31536000 seconds)' };
  }

  return { isValid: true };
};

// Max subscribers validation
export const validateMaxSubscribers = (max: number | undefined): { isValid: boolean; error?: string } => {
  if (max === undefined || max === null) {
    return { isValid: true }; // Optional field
  }

  if (typeof max !== 'number' || isNaN(max)) {
    return { isValid: false, error: 'Max subscribers must be a valid number' };
  }

  if (max <= 0) {
    return { isValid: false, error: 'Max subscribers must be greater than 0' };
  }

  if (max > 1000000) {
    return { isValid: false, error: 'Max subscribers must be less than 1,000,000' };
  }

  return { isValid: true };
};

// Description validation
export const validateDescription = (description: string): { isValid: boolean; error?: string } => {
  if (!description) {
    return { isValid: true }; // Optional field
  }

  if (description.length > 500) {
    return { isValid: false, error: 'Description must be less than 500 characters long' };
  }

  return { isValid: true };
};

// Features validation
export const validateFeatures = (features: string[]): { isValid: boolean; error?: string } => {
  if (!Array.isArray(features)) {
    return { isValid: false, error: 'Features must be an array' };
  }

  if (features.length > 20) {
    return { isValid: false, error: 'Cannot have more than 20 features' };
  }

  for (const feature of features) {
    if (typeof feature !== 'string') {
      return { isValid: false, error: 'All features must be strings' };
    }

    if (feature.trim().length === 0) {
      return { isValid: false, error: 'Feature cannot be empty' };
    }

    if (feature.length > 100) {
      return { isValid: false, error: 'Feature must be less than 100 characters long' };
    }
  }

  return { isValid: true };
};

// Payment method validation
export const validatePaymentMethod = (paymentMethod: string): { isValid: boolean; error?: string } => {
  if (!paymentMethod) {
    return { isValid: false, error: 'Payment method is required' };
  }

  return validateStellarAddress(paymentMethod);
};

// Subscription ID validation
export const validateSubscriptionId = (subscriptionId: string): { isValid: boolean; error?: string } => {
  if (!subscriptionId) {
    return { isValid: false, error: 'Subscription ID is required' };
  }

  if (subscriptionId.length < 3) {
    return { isValid: false, error: 'Subscription ID must be at least 3 characters long' };
  }

  if (subscriptionId.length > 100) {
    return { isValid: false, error: 'Subscription ID must be less than 100 characters long' };
  }

  // Allow alphanumeric, hyphens, and underscores
  const validChars = /^[a-zA-Z0-9_-]+$/;
  if (!validChars.test(subscriptionId)) {
    return { isValid: false, error: 'Subscription ID can only contain letters, numbers, hyphens, and underscores' };
  }

  return { isValid: true };
};

// Platform fee validation
export const validatePlatformFee = (feeBps: number): { isValid: boolean; error?: string } => {
  if (feeBps === null || feeBps === undefined) {
    return { isValid: false, error: 'Platform fee is required' };
  }

  if (typeof feeBps !== 'number' || isNaN(feeBps)) {
    return { isValid: false, error: 'Platform fee must be a valid number' };
  }

  if (feeBps < 0) {
    return { isValid: false, error: 'Platform fee cannot be negative' };
  }

  if (feeBps > 1000) {
    return { isValid: false, error: 'Platform fee cannot exceed 10% (1000 basis points)' };
  }

  return { isValid: true };
};

// Date validation
export const validateDate = (date: string): { isValid: boolean; error?: string } => {
  if (!date) {
    return { isValid: false, error: 'Date is required' };
  }

  const dateObj = new Date(date);
  if (isNaN(dateObj.getTime())) {
    return { isValid: false, error: 'Invalid date format' };
  }

  return { isValid: true };
};

// Future date validation
export const validateFutureDate = (date: string): { isValid: boolean; error?: string } => {
  const dateValidation = validateDate(date);
  if (!dateValidation.isValid) {
    return dateValidation;
  }

  const dateObj = new Date(date);
  const now = new Date();

  if (dateObj <= now) {
    return { isValid: false, error: 'Date must be in the future' };
  }

  return { isValid: true };
};

// Password validation
export const validatePassword = (password: string): { isValid: boolean; error?: string } => {
  if (!password) {
    return { isValid: false, error: 'Password is required' };
  }

  if (password.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters long' };
  }

  if (password.length > 128) {
    return { isValid: false, error: 'Password must be less than 128 characters long' };
  }

  // Check for at least one uppercase letter
  if (!/[A-Z]/.test(password)) {
    return { isValid: false, error: 'Password must contain at least one uppercase letter' };
  }

  // Check for at least one lowercase letter
  if (!/[a-z]/.test(password)) {
    return { isValid: false, error: 'Password must contain at least one lowercase letter' };
  }

  // Check for at least one number
  if (!/[0-9]/.test(password)) {
    return { isValid: false, error: 'Password must contain at least one number' };
  }

  return { isValid: true };
};

// URL validation
export const validateUrl = (url: string): { isValid: boolean; error?: string } => {
  if (!url) {
    return { isValid: true }; // Optional field
  }

  try {
    new URL(url);
    return { isValid: true };
  } catch {
    return { isValid: false, error: 'Please enter a valid URL' };
  }
};

// Phone number validation
export const validatePhone = (phone: string): { isValid: boolean; error?: string } => {
  if (!phone) {
    return { isValid: true }; // Optional field
  }

  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');

  if (cleaned.length < 10) {
    return { isValid: false, error: 'Phone number must have at least 10 digits' };
  }

  if (cleaned.length > 15) {
    return { isValid: false, error: 'Phone number cannot have more than 15 digits' };
  }

  return { isValid: true };
};

// Credit card validation
export const validateCreditCard = (cardNumber: string): { isValid: boolean; error?: string; type?: string } => {
  if (!cardNumber) {
    return { isValid: false, error: 'Card number is required' };
  }

  // Remove all non-digit characters
  const cleaned = cardNumber.replace(/\D/g, '');

  if (cleaned.length < 13 || cleaned.length > 19) {
    return { isValid: false, error: 'Card number must be between 13 and 19 digits' };
  }

  // Luhn algorithm check
  let sum = 0;
  let isEven = false;

  for (let i = cleaned.length - 1; i >= 0; i--) {
    let digit = parseInt(cleaned[i], 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  if (sum % 10 !== 0) {
    return { isValid: false, error: 'Invalid card number' };
  }

  // Determine card type
  let cardType = 'unknown';
  if (/^4/.test(cleaned)) cardType = 'visa';
  else if (/^5[1-5]/.test(cleaned)) cardType = 'mastercard';
  else if (/^3[47]/.test(cleaned)) cardType = 'amex';
  else if (/^6(?:011|5)/.test(cleaned)) cardType = 'discover';

  return { isValid: true, type: cardType };
};

// CVV validation
export const validateCVV = (cvv: string, cardType?: string): { isValid: boolean; error?: string } => {
  if (!cvv) {
    return { isValid: false, error: 'CVV is required' };
  }

  const cleaned = cvv.replace(/\D/g, '');

  // Amex uses 4-digit CVV, others use 3-digit
  const expectedLength = cardType === 'amex' ? 4 : 3;

  if (cleaned.length !== expectedLength) {
    return { isValid: false, error: `CVV must be ${expectedLength} digits` };
  }

  return { isValid: true };
};

// Expiry date validation
export const validateExpiry = (expiry: string): { isValid: boolean; error?: string } => {
  if (!expiry) {
    return { isValid: false, error: 'Expiry date is required' };
  }

  // Accept MM/YY or MM/YYYY format
  const match = expiry.match(/^(\d{2})\/(\d{2,4})$/);
  if (!match) {
    return { isValid: false, error: 'Expiry date must be in MM/YY or MM/YYYY format' };
  }

  let [_, month, year] = match;
  let fullYear = parseInt(year);

  // Convert 2-digit year to 4-digit
  if (fullYear < 100) {
    const currentYear = new Date().getFullYear();
    const century = Math.floor(currentYear / 100) * 100;
    fullYear = century + fullYear;
    
    // If the 2-digit year is in the past, assume next century
    if (fullYear < currentYear) {
      fullYear += 100;
    }
  }

  const monthNum = parseInt(month);
  if (monthNum < 1 || monthNum > 12) {
    return { isValid: false, error: 'Month must be between 01 and 12' };
  }

  const expiryDate = new Date(fullYear, monthNum - 1, 1);
  const now = new Date();

  if (expiryDate <= now) {
    return { isValid: false, error: 'Card has expired' };
  }

  return { isValid: true };
};

// File validation
export const validateFile = (file: File, options: {
  maxSize?: number; // in bytes
  allowedTypes?: string[];
  allowedExtensions?: string[];
}): { isValid: boolean; error?: string } => {
  const { maxSize = 5 * 1024 * 1024, allowedTypes = [], allowedExtensions = [] } = options;

  if (!file) {
    return { isValid: false, error: 'File is required' };
  }

  if (file.size > maxSize) {
    return { isValid: false, error: `File size must be less than ${maxSize / 1024 / 1024}MB` };
  }

  if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
    return { isValid: false, error: `File type must be one of: ${allowedTypes.join(', ')}` };
  }

  if (allowedExtensions.length > 0) {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      return { isValid: false, error: `File extension must be one of: ${allowedExtensions.join(', ')}` };
    }
  }

  return { isValid: true };
};

// Form validation helper
export const validateForm = <T extends Record<string, any>>(
  data: T,
  validators: Partial<Record<keyof T, (value: any) => { isValid: boolean; error?: string }>>
): { isValid: boolean; errors: Partial<Record<keyof T, string>> } => {
  const errors: Partial<Record<keyof T, string>> = {};
  let isValid = true;

  for (const [field, validator] of Object.entries(validators)) {
    if (validator) {
      const result = validator(data[field]);
      if (!result.isValid) {
        errors[field as keyof T] = result.error || 'Invalid value';
        isValid = false;
      }
    }
  }

  return { isValid, errors };
};

// Async validation helper
export const validateAsync = async <T>(
  value: T,
  validator: (value: T) => Promise<{ isValid: boolean; error?: string }>
): Promise<{ isValid: boolean; error?: string }> => {
  try {
    return await validator(value);
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
};

// Debounced validation
export const createDebouncedValidator = <T>(
  validator: (value: T) => { isValid: boolean; error?: string },
  delay = 300
) => {
  let timeoutId: NodeJS.Timeout;

  return (value: T, callback: (result: { isValid: boolean; error?: string }) => void) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      callback(validator(value));
    }, delay);
  };
};
