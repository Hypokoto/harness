export class ProfileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProfileError';
  }
}

export class ProfileNotFoundError extends ProfileError {
  public readonly profileName: string;
  constructor(profileName: string, message?: string) {
    super(message ?? `Profile "${profileName}" not found.`);
    this.name = 'ProfileNotFoundError';
    this.profileName = profileName;
  }
}

export class InvalidProfileError extends ProfileError {
  public readonly validationErrors: string[];
  constructor(message: string, validationErrors: string[] = []) {
    super(message);
    this.name = 'InvalidProfileError';
    this.validationErrors = validationErrors;
  }
}

export class TOMLParseError extends ProfileError {
  public readonly line?: number;
  constructor(message: string, line?: number) {
    super(line !== undefined ? `TOML Parse Error at line ${line}: ${message}` : `TOML Parse Error: ${message}`);
    this.name = 'TOMLParseError';
    this.line = line;
  }
}
