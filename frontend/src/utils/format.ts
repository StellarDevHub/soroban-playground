// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Currency formatting
export const formatCurrency = (amount: number, currency = 'USD'): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

// Date formatting
export const formatDate = (date: string | Date): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(dateObj);
};

export const formatDateTime = (date: string | Date): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dateObj);
};

export const formatRelativeTime = (date: string | Date): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = dateObj.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 1 && diffDays <= 7) return `In ${diffDays} days`;
  if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`;
  
  return formatDate(dateObj);
};

// Duration formatting
export const formatDuration = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return years === 1 ? 'year' : 'years';
  if (months > 0) return months === 1 ? 'month' : 'months';
  if (weeks > 0) return weeks === 1 ? 'week' : 'weeks';
  if (days > 0) return days === 1 ? 'day' : 'days';
  
  return 'seconds';
};

export const formatDurationExact = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
};

// Number formatting
export const formatNumber = (num: number): string => {
  return new Intl.NumberFormat('en-US').format(num);
};

export const formatPercentage = (value: number, decimals = 1): string => {
  return `${(value * 100).toFixed(decimals)}%`;
};

export const formatFileSize = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
};

// Address formatting (Stellar addresses)
export const formatAddress = (address: string, startChars = 6, endChars = 4): string => {
  if (!address || address.length <= startChars + endChars) {
    return address;
  }
  
  return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
};

// Transaction hash formatting
export const formatTxHash = (hash: string, startChars = 8, endChars = 8): string => {
  return formatAddress(hash, startChars, endChars);
};

// Plan ID formatting
export const formatPlanId = (planId: string): string => {
  return planId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

// Subscription ID formatting
export const formatSubscriptionId = (subscriptionId: string): string => {
  return formatAddress(subscriptionId, 8, 4);
};

// Status formatting
export const formatStatus = (status: string): string => {
  return status.split('_').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ');
};

// Error formatting
export const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unknown error occurred';
};

// Validation formatting
export const formatValidationErrors = (errors: string[]): string => {
  return errors.map((error, index) => `${index + 1}. ${error}`).join('\n');
};

// Time formatting helpers
export const getTimeRemaining = (endDate: string | Date): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
  formatted: string;
} => {
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate;
  const now = new Date();
  const total = Math.max(0, end.getTime() - now.getTime());
  
  const days = Math.floor(total / (1000 * 60 * 60 * 24));
  const hours = Math.floor((total % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((total % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((total % (1000 * 60)) / 1000);

  const formatted = formatDurationExact(total / 1000);

  return {
    days,
    hours,
    minutes,
    seconds,
    total,
    formatted,
  };
};

// Billing period formatting
export const formatBillingPeriod = (seconds: number): string => {
  const days = seconds / 86400;
  
  if (days === 1) return 'Daily';
  if (days === 7) return 'Weekly';
  if (days === 30) return 'Monthly';
  if (days === 90) return 'Quarterly';
  if (days === 365) return 'Yearly';
  
  return `Every ${days} days`;
};

// Revenue formatting with appropriate units
export const formatRevenue = (revenue: number): string => {
  if (revenue >= 1000000) {
    return `${formatCurrency(revenue / 1000000)}M`;
  }
  if (revenue >= 1000) {
    return `${formatCurrency(revenue / 1000)}K`;
  }
  return formatCurrency(revenue);
};

// Growth formatting
export const formatGrowth = (growth: number): { value: string; color: string; icon: string } => {
  const isPositive = growth >= 0;
  const value = formatPercentage(Math.abs(growth));
  
  return {
    value: isPositive ? `+${value}` : `-${value}`,
    color: isPositive ? 'text-green-600' : 'text-red-600',
    icon: isPositive ? 'trending-up' : 'trending-down',
  };
};

// Progress formatting
export const formatProgress = (current: number, total: number): {
  percentage: number;
  formatted: string;
  color: string;
} => {
  const percentage = Math.min(100, Math.max(0, (current / total) * 100));
  
  let color = 'bg-blue-500';
  if (percentage >= 80) color = 'bg-red-500';
  else if (percentage >= 60) color = 'bg-yellow-500';
  else if (percentage >= 40) color = 'bg-green-500';

  return {
    percentage,
    formatted: `${formatNumber(current)} / ${formatNumber(total)} (${formatPercentage(percentage / 100)})`,
    color,
  };
};

// URL formatting
export const formatUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname + urlObj.pathname;
  } catch {
    return url;
  }
};

// Email formatting
export const formatEmail = (email: string): string => {
  const [username, domain] = email.split('@');
  if (!domain) return email;
  
  const maskedUsername = username.length > 3 
    ? username.substring(0, 3) + '*'.repeat(username.length - 3)
    : username;
  
  return `${maskedUsername}@${domain}`;
};

// Phone number formatting
export const formatPhone = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length === 10) {
    return `(${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6)}`;
  }
  
  return phone;
};

// Credit card formatting
export const formatCreditCard = (cardNumber: string): string => {
  const cleaned = cardNumber.replace(/\D/g, '');
  const groups = cleaned.match(/(\d{1,4})/g) || [];
  
  return groups.join(' ').substring(0, 19); // Max 19 characters for typical cards
};

// Expiration date formatting
export const formatExpiry = (expiry: string): string => {
  if (expiry.includes('/')) {
    return expiry;
  }
  
  if (expiry.length === 4) {
    return `${expiry.substring(0, 2)}/${expiry.substring(2)}`;
  }
  
  return expiry;
};

// CSV formatting
export const formatCsvValue = (value: any): string => {
  if (value === null || value === undefined) {
    return '';
  }
  
  const stringValue = String(value);
  
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  
  return stringValue;
};

// JSON formatting
export const formatJson = (obj: any, indent = 2): string => {
  return JSON.stringify(obj, null, indent);
};

// Truncate text
export const truncateText = (text: string, maxLength: number, suffix = '...'): string => {
  if (text.length <= maxLength) {
    return text;
  }
  
  return text.substring(0, maxLength - suffix.length) + suffix;
};

// Capitalize words
export const capitalizeWords = (text: string): string => {
  return text.replace(/\b\w/g, l => l.toUpperCase());
};

// Slugify text
export const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

// Generate random ID
export const generateId = (prefix = '', length = 8): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return prefix ? `${prefix}_${result}` : result;
};

// Color formatting (hex to RGB)
export const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null;
};

// RGB to hex
export const rgbToHex = (r: number, g: number, b: number): string => {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
};

// Get contrast color (black or white) based on background
export const getContrastColor = (hex: string): string => {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#000000';
  
  // Calculate luminance
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  
  return luminance > 0.5 ? '#000000' : '#ffffff';
};
