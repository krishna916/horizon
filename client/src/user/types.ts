export interface RegisterUserRequest {
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CurrentUserResponse {
  id: number;
  email: string;
}
