import { useMutation } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { userApi } from '../api';
import { useAuthSession } from '../session/AuthSessionProvider';
import { publishSessionMarker } from '../session/sessionMarker';

export const useLogoutUser = () => {
  const { acceptLocalLogout } = useAuthSession();
  return useMutation<void, AxiosError>({
    mutationFn: async () => {
      await userApi.logout();
    },
    onSuccess: () => {
      acceptLocalLogout();
      publishSessionMarker();
    },
  });
};
