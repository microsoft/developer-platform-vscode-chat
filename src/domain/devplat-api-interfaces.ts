// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { JSONSchema7 } from 'json-schema';
import { components } from './devplat-api-openapi';
export type DevPlatApiEntity = components['schemas']['Entity'];
export type DevPlatApiTemplateRequest = components['schemas']['TemplateRequest'];

export interface PropDetail extends JSONSchema7 {
    name: string;
    isRequired: boolean;
}

export interface ProviderAuthInfo {
    realm: string;
    authorization_uri: string;
    scopes: string;
}

export interface DevPlatApiResult {
    success: boolean;
    status: number;
    retryAfter?: number;
    additionalAuthRequested: boolean;
    additionalAuthInfo: ProviderAuthInfo;
    text: string;
    json: any;
}

export interface TemplateSummary {
    resultIndex: number;
    templateRef: string;
    name: string;
    title: string;
    description: string;
    tags: string[];
    creates: string[];
}

export interface TemplateDetail extends DevPlatApiEntity {
    resultIndex: number | undefined;
    templateRef: string | undefined;
}

export interface DevPlatApiResult {
    success: boolean;
    status: number;
    retryAfter?: number;
    additionalAuthRequested: boolean;
    additionalAuthInfo: ProviderAuthInfo;
    text: string;
    json: any;
}

export interface TemplateSummary {
    resultIndex: number;
    templateRef: string;
    name: string;
    title: string;
    description: string;
    tags: string[];
    creates: string[];
}

export interface TemplateDetail extends DevPlatApiEntity {
    resultIndex: number | undefined;
    templateRef: string | undefined;
}
