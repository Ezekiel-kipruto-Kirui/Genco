export const isChiefAdmin = (userRole: string | null): boolean => {
  return userRole === 'chief-admin';
};