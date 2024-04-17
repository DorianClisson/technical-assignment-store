import { JSONArray, JSONObject, JSONPrimitive } from "./json-types";
import get from "lodash/get";
import set from "lodash/set";

export type Permission = "r" | "w" | "rw" | "none";

export type StoreResult = Store | JSONPrimitive | undefined;

export type StoreValue =
    | JSONObject
    | JSONArray
    | StoreResult
    | (() => StoreResult);

export interface IStore {
    defaultPolicy: Permission;
    allowedToRead(key: string): boolean;
    allowedToWrite(key: string): boolean;
    read(path: string): StoreResult;
    write(path: string, value: StoreValue): StoreValue;
    writeEntries(entries: JSONObject): void;
    entries(): JSONObject;
}

export function Restrict(
    permission?: Permission
): (target: Store, propertyKey: string) => void {
    return function (target, propertyKey) {
        // if no permission is given then we do not need to store because defaultPolicy will be applied
        if (permission) {
            set(target, `permissionsList.${propertyKey}`, permission);
        }
    };
}

// constants
const READ_PERMISSIONS: Permission[] = ["r", "rw"];
const WRITE_PERMISSIONS: Permission[] = ["w", "rw"];
const RECURSIVE_LOOP_LIMIT: number = 10; // just to ensure to not have an infinite loop : might be adjusted

// helpers
const recursiveRead = (
    object: JSONObject | Store,
    splittedPath: string[],
    recursiveDepth: number = 0
): StoreResult => {
    const [firstKey, ...restPath] = splittedPath;

    const firstKeyValue: StoreValue = get(object, firstKey);

    // if no more path to loop through then return
    if (restPath.length === 0) {
        if (typeof firstKeyValue === "function") {
            return firstKeyValue();
        }
        return firstKeyValue as StoreResult;
    }

    // restPath > 0

    // if Store then read with this Store and keep processing within the new Store
    if (firstKeyValue instanceof Store) {
        return firstKeyValue.read(restPath.join(":"));
    }
    // function return Store so same read with this Store and keep processing within it
    if (typeof firstKeyValue === "function") {
        return (firstKeyValue() as Store).read(restPath.join(":"));
    }

    // else it is a nested object so loop through it with the lefted path
    if (recursiveDepth + 1 === RECURSIVE_LOOP_LIMIT) {
        throw new Error(
            "Reached RECURSIVE_LOOP_LIMIT. Please adjust if needed."
        );
    }
    return recursiveRead(
        firstKeyValue as JSONObject,
        restPath,
        recursiveDepth + 1
    );
};

export class Store implements IStore {
    defaultPolicy: Permission = "rw";

    // used to store all the different permissions for each key using Restrict decorator
    permissionsList?: Record<string, Permission>;

    allowedToRead(key: string): boolean {
        const permission = this.permissionsList?.[key];
        return READ_PERMISSIONS.includes(permission ?? this.defaultPolicy);
    }

    allowedToWrite(key: string): boolean {
        const permission = this.permissionsList?.[key];
        return WRITE_PERMISSIONS.includes(permission ?? this.defaultPolicy);
    }

    read(path: string): StoreResult {
        const splittedPath = path.split(":");
        if (!this.allowedToRead(splittedPath[0])) {
            throw new Error(
                `Insufficient permission to read ${splittedPath[0]}`
            );
        }

        return recursiveRead(this, splittedPath);
    }

    // helper in the Store class because of Store -> allowedToWrite usage
    recursiveWrite = (
        object: JSONObject | Store,
        splittedPath: string[],
        value: StoreValue,
        recursiveDepth: number = 0
    ): void => {
        const [firstKey, ...restPath] = splittedPath;

        // if no more path to loop through then write & return
        if (restPath.length === 0) {
            if (!this.allowedToWrite(firstKey)) {
                throw new Error(`Insufficient permission to write ${firstKey}`);
            }
            set(object, firstKey, value);
            return;
        }

        // restPath > 0

        const firstKeyValue: StoreValue = get(object, firstKey);

        // if Store then write with this Store and keep processing within the new Store
        if (firstKeyValue instanceof Store) {
            firstKeyValue.write(restPath.join(":"), value);
            return;
        }
        // function return Store so same write with this Store and keep processing within it
        if (typeof firstKeyValue === "function") {
            (firstKeyValue() as Store).write(restPath.join(":"), value);
            return;
        }

        // else create an object and loop through it
        if (recursiveDepth + 1 === RECURSIVE_LOOP_LIMIT) {
            throw new Error(
                "Reached RECURSIVE_LOOP_LIMIT. Please adjust if needed."
            );
        }
        set(object, firstKey, {});
        this.recursiveWrite(
            get(object, firstKey),
            restPath,
            value,
            recursiveDepth + 1
        );
    };

    write(path: string, value: StoreValue): StoreValue {
        this.recursiveWrite(this, path.split(":"), value);
        return value;
    }

    writeEntries(entries: JSONObject): void {
        Object.entries(entries).forEach(([key, value]) => {
            this.write(key, value);
        });
    }

    entries(): JSONObject {
        return Object.entries(this).reduce<JSONObject>((res, [key, value]) => {
            if (this.allowedToRead(key)) {
                res[key] = value;
            }
            return res;
        }, {});
    }
}
