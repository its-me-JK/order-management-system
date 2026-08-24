import { SetMetadata } from '@nestjs/common';

import type { AuthRole } from './auth.contracts';

export const AUTH_ROLES_METADATA = 'oms.auth.roles';

export const Roles = (...roles: readonly AuthRole[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(AUTH_ROLES_METADATA, roles);
